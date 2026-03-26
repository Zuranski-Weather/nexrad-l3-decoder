import { BinaryReader, toHex } from './utils';
import type {
  DataPacket, RadialPacket, Radial, RleRadialPacket, RleRadial,
  RasterPacket, RasterRow, TextPacket, GenericPacket, UnknownPacket,
} from '../types';

export function parsePackets(reader: BinaryReader, layerEnd: number): DataPacket[] {
  const packets: DataPacket[] = [];
  while (reader.offset < layerEnd) {
    if (reader.remaining() < 2) break;
    const packetCode = reader.readUint16();
    const packet = parsePacket(packetCode, reader, layerEnd);
    packets.push(packet);
  }
  return packets;
}

function parsePacket(packetCode: number, reader: BinaryReader, layerEnd: number): DataPacket {
  switch (packetCode) {
    case 16:
      return parseDigitalRadialPacket(packetCode, reader);
    case 0xaf1f:
      return parseRleRadialPacket(packetCode, reader);
    case 0xba0f:
    case 0xba07:
      return parseRasterPacket(packetCode, reader);
    case 1:
      return parseTextPacket(packetCode, reader, false);
    case 2:
      return parseTextPacket(packetCode, reader, false);
    case 8:
      return parseTextPacket(packetCode, reader, true);
    case 28:
    case 29:
      return parseGenericPacket(packetCode, reader);
    default:
      return parseUnknownPacket(packetCode, reader, layerEnd);
  }
}

// Packet Code 16 - Digital Radial Data Array (256 levels, 1 byte per bin)
function parseDigitalRadialPacket(packetCode: number, reader: BinaryReader): RadialPacket {
  const indexOfFirstRangeBin = reader.readUint16();
  const numberOfRangeBins = reader.readUint16();
  const iCenter = reader.readInt16();
  const jCenter = reader.readInt16();
  const scaleFactor = reader.readUint16();
  const numberOfRadials = reader.readUint16();

  const radials: Radial[] = [];
  for (let i = 0; i < numberOfRadials; i++) {
    const numBytes = reader.readUint16();
    const startAngle = reader.readUint16() / 10;
    const angleDelta = reader.readUint16() / 10;
    const bins = reader.readBytes(numBytes);
    // Pad to halfword boundary
    if (numBytes % 2 !== 0) {
      reader.skip(1);
    }
    radials.push({ startAngle, angleDelta, numBytes, bins: new Uint8Array(bins) });
  }

  return {
    packetCode,
    indexOfFirstRangeBin,
    numberOfRangeBins,
    iCenter,
    jCenter,
    scaleFactor,
    numberOfRadials,
    radials,
  };
}

// Packet Code AF1F - Radial Data (16 levels, 4-bit RLE)
function parseRleRadialPacket(packetCode: number, reader: BinaryReader): RleRadialPacket {
  const indexOfFirstRangeBin = reader.readUint16();
  const numberOfRangeBins = reader.readUint16();
  const iCenter = reader.readInt16();
  const jCenter = reader.readInt16();
  const scaleFactor = reader.readUint16();
  const numberOfRadials = reader.readUint16();

  const radials: RleRadial[] = [];
  for (let i = 0; i < numberOfRadials; i++) {
    const numHalfwords = reader.readUint16();
    const startAngle = reader.readUint16() / 10;
    const angleDelta = reader.readUint16() / 10;

    const runs: Array<{ run: number; color: number }> = [];
    for (let h = 0; h < numHalfwords; h++) {
      const hw = reader.readUint16();
      // Each halfword has two 4-bit RLE pairs: high byte and low byte
      const run1 = (hw >> 12) & 0x0f;
      const color1 = (hw >> 8) & 0x0f;
      const run2 = (hw >> 4) & 0x0f;
      const color2 = hw & 0x0f;
      if (run1 > 0 || color1 > 0) runs.push({ run: run1, color: color1 });
      if (run2 > 0 || color2 > 0) runs.push({ run: run2, color: color2 });
    }
    radials.push({ startAngle, angleDelta, numHalfwords, runs });
  }

  return {
    packetCode,
    indexOfFirstRangeBin,
    numberOfRangeBins,
    iCenter,
    jCenter,
    scaleFactor,
    numberOfRadials,
    radials,
  };
}

// Packet Codes BA0F / BA07 - Raster Data (4-bit RLE)
function parseRasterPacket(packetCode: number, reader: BinaryReader): RasterPacket {
  const opFlags = reader.readUint16(); // 0x8000
  reader.readUint16(); // 0x00C0
  const iStart = reader.readInt16();
  const jStart = reader.readInt16();
  const xScaleInt = reader.readUint16();
  const xScaleFrac = reader.readUint16();
  const yScaleInt = reader.readUint16();
  const yScaleFrac = reader.readUint16();
  const numberOfRows = reader.readUint16();
  const packingDescriptor = reader.readUint16();

  const rows: RasterRow[] = [];
  for (let r = 0; r < numberOfRows; r++) {
    const numBytes = reader.readUint16();
    const runs: Array<{ run: number; color: number }> = [];
    const bytesToRead = numBytes;
    let bytesRead = 0;
    while (bytesRead < bytesToRead) {
      const b = reader.readUint8();
      bytesRead++;
      const run = (b >> 4) & 0x0f;
      const color = b & 0x0f;
      runs.push({ run, color });
    }
    // Pad to halfword boundary
    if (numBytes % 2 !== 0) {
      reader.skip(1);
    }
    rows.push({ numBytes, runs });
  }

  return {
    packetCode,
    opFlags,
    iStart,
    jStart,
    xScaleInt,
    xScaleFrac,
    yScaleInt,
    yScaleFrac,
    numberOfRows,
    packingDescriptor,
    rows,
  };
}

// Packet Codes 1, 2, 8 - Text Packets
function parseTextPacket(packetCode: number, reader: BinaryReader, hasColor: boolean): TextPacket {
  const dataLength = reader.readUint16();
  const startOffset = reader.offset;

  let colorLevel: number | undefined;
  if (hasColor) {
    colorLevel = reader.readUint16();
  }
  const iStart = reader.readInt16();
  const jStart = reader.readInt16();

  const textBytesLen = dataLength - (reader.offset - startOffset);
  const textBytes = reader.readBytes(textBytesLen);
  let text = '';
  for (let i = 0; i < textBytes.length; i++) {
    const ch = textBytes[i];
    if (ch >= 0x20 && ch <= 0x7e) {
      text += String.fromCharCode(ch);
    } else if (ch === 0x0a || ch === 0x0d) {
      text += '\n';
    }
  }

  return { packetCode, colorLevel, iStart, jStart, text };
}

// Packet Codes 28, 29 - Generic Data Packet
function parseGenericPacket(packetCode: number, reader: BinaryReader): GenericPacket {
  const reserved = reader.readUint16();
  const lengthMsw = reader.readUint16();
  const lengthLsw = reader.readUint16();
  const dataLength = (lengthMsw << 16) | lengthLsw;

  const rawData = reader.readBytes(dataLength);

  return { packetCode, reserved, dataLength, rawData: new Uint8Array(rawData) };
}

// Fallback for unknown packet codes
function parseUnknownPacket(packetCode: number, reader: BinaryReader, layerEnd: number): UnknownPacket {
  // Most packets have a length field as the second halfword
  const rawLength = reader.readUint16();

  // Known packets with length-prefixed data blocks
  const knownLengthPackets = new Set([
    3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    0x0802, 0x0e03, 0x3501, 0x0e23, 0x4e00, 0x3521, 0x4e01,
  ]);

  if (knownLengthPackets.has(packetCode) && rawLength > 0 && reader.offset + rawLength <= layerEnd) {
    reader.skip(rawLength);
  } else {
    // Skip to end of layer as we can't determine packet length
    const skipTo = Math.min(layerEnd, reader.length);
    reader.seek(skipTo);
  }

  return {
    packetCode,
    rawLength,
    description: getPacketDescription(packetCode),
  };
}

function getPacketDescription(code: number): string {
  const descriptions: Record<number, string> = {
    3: 'Mesocyclone Symbol',
    4: 'Wind Barb Data',
    5: 'Vector Arrow Data',
    6: 'Linked Vector (No Value)',
    7: 'Unlinked Vector (No Value)',
    9: 'Linked Vector (Uniform Value)',
    10: 'Unlinked Vector (Uniform Value)',
    11: '3D Correlated Shear Symbol',
    12: 'TVS Symbol',
    13: 'Hail Positive Symbol',
    14: 'Hail Probable Symbol',
    15: 'Storm ID Symbol',
    17: 'Digital Precipitation Data Array',
    18: 'Precipitation Rate Data Array',
    19: 'HDA Hail Symbol',
    20: 'Point Feature Symbol',
    21: 'Cell Trend Data',
    22: 'Cell Trend Volume Scan Times',
    23: 'SCIT Past Position Data',
    24: 'SCIT Forecast Position Data',
    25: 'STI Circle',
    26: 'ETVS Symbol',
    33: 'Digital Raster Data Array',
    0x0802: 'Set Color Level (Contour)',
    0x0e03: 'Linked Contour Vectors',
    0x3501: 'Unlinked Contour Vectors',
    0x0e23: 'Map Linked Vectors',
    0x4e00: 'Map Text',
    0x3521: 'Map Unlinked Vectors',
    0x4e01: 'Map Special Symbols',
  };
  return descriptions[code] || `Unknown Packet (${toHex(code)})`;
}
