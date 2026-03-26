import { BinaryReader } from './utils';
import { parsePackets } from './packets';
import { bz2Decompress } from './bz2';
import type { SymbologyBlock, DataLayer } from '../types';

export function parseSymbologyBlock(
  fullBuffer: ArrayBuffer,
  messageStartOffset: number,
  symbologyOffsetHalfwords: number,
  compressionMethod: number,
  _uncompressedSize: number,
  messageLength: number,
): SymbologyBlock | undefined {
  if (symbologyOffsetHalfwords === 0) return undefined;

  const symbologyByteOffset = messageStartOffset + symbologyOffsetHalfwords * 2;
  const messageEndOffset = messageStartOffset + messageLength;
  const compressedSize = messageEndOffset - symbologyByteOffset;

  let dataBuffer: ArrayBuffer;
  let compressed = false;

  if (compressionMethod === 1) {
    compressed = true;
    const compressedData = new Uint8Array(fullBuffer, symbologyByteOffset, compressedSize);
    const decompressed: Uint8Array = bz2Decompress(compressedData);
    dataBuffer = decompressed.buffer.slice(
      decompressed.byteOffset,
      decompressed.byteOffset + decompressed.byteLength,
    );
  } else {
    dataBuffer = fullBuffer.slice(symbologyByteOffset);
  }

  const reader = new BinaryReader(dataBuffer);

  // Block Divider: expected -1 (0xFFFF) for uncompressed, but compressed
  // products typically have 0x00FF at the start of decompressed data
  const divider = reader.readInt16();
  if (divider !== -1 && !(compressed && divider === 0x00FF)) {
    throw new Error(`Expected symbology block divider (-1), got ${divider}`);
  }

  const blockId = reader.readUint16();
  const blockLength = reader.readUint32();
  const numberOfLayers = reader.readUint16();

  const layers: DataLayer[] = [];
  for (let i = 0; i < numberOfLayers; i++) {
    const layerDivider = reader.readInt16();
    if (layerDivider !== -1) {
      throw new Error(`Expected layer divider (-1), got ${layerDivider} at offset ${reader.offset - 2}`);
    }
    const layerLength = reader.readUint32();
    const layerEnd = reader.offset + layerLength;

    const packets = parsePackets(reader, layerEnd);
    layers.push({ layerLength, packets });

    // Ensure we're at the layer end
    reader.seek(layerEnd);
  }

  return {
    blockId,
    blockLength,
    numberOfLayers,
    layers,
    compressed,
    compressedSize: compressed ? compressedSize : undefined,
    uncompressedSize: compressed ? _uncompressedSize : undefined,
  };
}
