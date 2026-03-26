import { detectAndStripWmoHeader } from './wmo';

const ZLIB_FLG_VALUES = new Set([0x01, 0x5E, 0x9C, 0xDA]);

/**
 * Detect and unwrap SBN/zlib-wrapped NEXRAD Level 3 products.
 *
 * Handles two NOAAPORT distribution formats:
 *   1. Single-block: One zlib stream (SBN CCB + WMO + L3 header/PD), followed by raw
 *      bzip2-compressed symbology bytes (e.g. CLE1.N0B).
 *   2. Multi-block: Multiple concatenated zlib streams, each expanding to 4000 bytes
 *      (last block may be shorter), with the first block containing the SBN/WMO/L3
 *      header and subsequent blocks containing the rest of the L3 message.
 *
 * Returns a reconstructed buffer in the standard format, or null if no
 * zlib wrapping was detected.
 */
export async function tryUnwrapSbnZlib(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  const bytes = new Uint8Array(buffer);

  // Find WMO data offset
  const { dataOffset } = detectAndStripWmoHeader(buffer);

  // Check for zlib magic at data offset
  if (dataOffset + 2 >= buffer.byteLength) return null;
  if (bytes[dataOffset] !== 0x78 || !ZLIB_FLG_VALUES.has(bytes[dataOffset + 1])) {
    return null;
  }

  // Decompress the first zlib block (may have trailing non-zlib data)
  const zlibInput = bytes.slice(dataOffset);
  const decompressed = await decompressZlibIgnoreTrailing(zlibInput);
  if (decompressed.length === 0) return null;

  // Find the Level 3 binary start inside the decompressed SBN block.
  // Structure: SBN CCB headers + WMO header copy + CRCRLF + PIL + CRCRLF + L3 binary
  // The L3 binary starts after the last CRCRLF where the next byte is non-printable.
  const l3Start = findL3StartInDecompressed(decompressed);
  if (l3Start < 0) return null;

  // Parse message length from the L3 header (offset 8-11 = UINT32 big-endian)
  const l3FromZlib = decompressed.slice(l3Start);
  if (l3FromZlib.length < 12) return null;
  const msgLenView = new DataView(l3FromZlib.buffer, l3FromZlib.byteOffset + 8, 4);
  const messageLength = msgLenView.getUint32(0, false);

  // Find where the first zlib stream ends in the original file using Adler-32 checksum
  const adler = computeAdler32(decompressed);
  const zlibEnd = findAdler32InFile(bytes, dataOffset + 2, adler);
  if (zlibEnd < 0) return null;

  const wmoPreamble = bytes.slice(0, dataOffset);
  const l3NeededFromRaw = messageLength - l3FromZlib.length;

  // Check if the continuation is more zlib blocks (multi-block SBN format).
  // In that case, chain-decompress each block until we have all the L3 data.
  if (
    l3NeededFromRaw > 0 &&
    zlibEnd + 1 < bytes.length &&
    bytes[zlibEnd] === 0x78 &&
    ZLIB_FLG_VALUES.has(bytes[zlibEnd + 1])
  ) {
    const additional = await decompressZlibChain(bytes, zlibEnd, l3NeededFromRaw);
    if (additional) {
      const totalSize = wmoPreamble.length + l3FromZlib.length + additional.length;
      const result = new Uint8Array(totalSize);
      result.set(wmoPreamble, 0);
      result.set(l3FromZlib, wmoPreamble.length);
      result.set(additional, wmoPreamble.length + l3FromZlib.length);
      return result.buffer;
    }
  }

  // Fallback: raw continuation (single-block + raw bzip2, e.g. CLE1.N0B format)
  const rawContinuation = bytes.slice(zlibEnd, zlibEnd + l3NeededFromRaw);
  const totalSize = wmoPreamble.length + l3FromZlib.length + rawContinuation.length;
  const result = new Uint8Array(totalSize);
  result.set(wmoPreamble, 0);
  result.set(l3FromZlib, wmoPreamble.length);
  result.set(rawContinuation, wmoPreamble.length + l3FromZlib.length);
  return result.buffer;
}

/**
 * Starting at `offset` in `bytes`, decompress a chain of back-to-back zlib blocks
 * (each ending exactly where the next begins) until `needed` bytes are accumulated.
 * Returns a Uint8Array of exactly `needed` bytes, or null if the chain fails.
 */
async function decompressZlibChain(
  bytes: Uint8Array,
  offset: number,
  needed: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let accumulated = 0;

  while (offset < bytes.length - 1 && accumulated < needed) {
    if (bytes[offset] !== 0x78 || !ZLIB_FLG_VALUES.has(bytes[offset + 1])) break;

    const chunk = await decompressZlibIgnoreTrailing(bytes.slice(offset));
    if (chunk.length === 0) break;
    chunks.push(chunk);
    accumulated += chunk.length;

    const adler = computeAdler32(chunk);
    const blockEnd = findAdler32InFile(bytes, offset + 2, adler);
    if (blockEnd < 0) break;
    offset = blockEnd;
  }

  if (accumulated < needed) return null;

  const result = new Uint8Array(needed);
  let pos = 0;
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, needed - pos);
    result.set(chunk.subarray(0, toCopy), pos);
    pos += toCopy;
    if (pos >= needed) break;
  }
  return result;
}

function findL3StartInDecompressed(data: Uint8Array): number {
  // Scan for CRCRLF (0x0d 0x0d 0x0a) followed by a non-ASCII byte (L3 binary data)
  for (let i = data.length - 5; i >= 0; i--) {
    if (data[i] === 0x0d && data[i + 1] === 0x0d && data[i + 2] === 0x0a) {
      const next = data[i + 3];
      if (next < 0x20 || next > 0x7e) {
        return i + 3;
      }
    }
  }
  return -1;
}

async function decompressZlibIgnoreTrailing(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream API not available — cannot decode zlib-wrapped SBN products');
  }

  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write all data and close; trailing non-zlib bytes may cause an error which we ignore
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});

  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    // Error from trailing garbage after the zlib stream is expected
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}

function computeAdler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function findAdler32InFile(bytes: Uint8Array, searchStart: number, adler: number): number {
  const b0 = (adler >>> 24) & 0xFF;
  const b1 = (adler >>> 16) & 0xFF;
  const b2 = (adler >>> 8) & 0xFF;
  const b3 = adler & 0xFF;

  // Search within reasonable range (zlib for ~4KB output is unlikely to exceed 16KB)
  const searchEnd = Math.min(searchStart + 16384, bytes.length - 3);
  for (let i = searchStart; i < searchEnd; i++) {
    if (bytes[i] === b0 && bytes[i + 1] === b1 && bytes[i + 2] === b2 && bytes[i + 3] === b3) {
      return i + 4;
    }
  }
  return -1;
}
