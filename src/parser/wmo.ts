import type { WmoHeader } from '../types';

const CR_CR_LF = [0x0d, 0x0d, 0x0a];

function findCrCrLf(data: Uint8Array, start: number): number {
  for (let i = start; i < data.length - 2; i++) {
    if (data[i] === CR_CR_LF[0] && data[i + 1] === CR_CR_LF[1] && data[i + 2] === CR_CR_LF[2]) {
      return i;
    }
  }
  return -1;
}

function isAsciiPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

export function detectAndStripWmoHeader(data: ArrayBuffer): { wmoHeader?: WmoHeader; dataOffset: number } {
  const bytes = new Uint8Array(data);

  // Check for SOH (0x01) NOAAPORT framing
  if (bytes[0] === 0x01) {
    return parseNoaaportHeader(bytes);
  }

  // Check for direct WMO header (starts with ASCII like "SDUS")
  if (isAsciiPrintable(bytes[0]) && isAsciiPrintable(bytes[1]) && isAsciiPrintable(bytes[2]) && isAsciiPrintable(bytes[3])) {
    return parseSimpleWmoHeader(bytes);
  }

  // No WMO header detected - raw Level 3 data
  return { dataOffset: 0 };
}

function parseNoaaportHeader(bytes: Uint8Array): { wmoHeader?: WmoHeader; dataOffset: number } {
  // SOH + CRCRLF + sequence + CRCRLF + WMO line + CRCRLF + PIL + CRCRLF
  let pos = 1; // skip SOH
  // Skip first CRCRLF
  const firstBreak = findCrCrLf(bytes, pos);
  if (firstBreak < 0) return { dataOffset: 0 };
  pos = firstBreak + 3;

  // Skip sequence number + CRCRLF
  const seqBreak = findCrCrLf(bytes, pos);
  if (seqBreak < 0) return { dataOffset: 0 };
  pos = seqBreak + 3;

  // WMO header line
  const wmoBreak = findCrCrLf(bytes, pos);
  if (wmoBreak < 0) return { dataOffset: 0 };
  const wmoLine = textFromBytes(bytes, pos, wmoBreak);
  pos = wmoBreak + 3;

  // AWIPS PIL line
  const pilBreak = findCrCrLf(bytes, pos);
  if (pilBreak < 0) return { dataOffset: 0 };
  const pilLine = textFromBytes(bytes, pos, pilBreak);
  pos = pilBreak + 3;

  const parts = wmoLine.split(/\s+/);

  return {
    wmoHeader: {
      raw: wmoLine + '\n' + pilLine,
      wmoId: parts[0] || '',
      station: parts[1] || '',
      datetime: parts[2] || '',
      awipsPil: pilLine,
      dataOffset: pos,
    },
    dataOffset: pos,
  };
}

function parseSimpleWmoHeader(bytes: Uint8Array): { wmoHeader?: WmoHeader; dataOffset: number } {
  // WMO line + CRCRLF + PIL + CRCRLF
  const wmoBreak = findCrCrLf(bytes, 0);
  if (wmoBreak < 0) return { dataOffset: 0 };
  const wmoLine = textFromBytes(bytes, 0, wmoBreak);
  let pos = wmoBreak + 3;

  const pilBreak = findCrCrLf(bytes, pos);
  if (pilBreak < 0) return { dataOffset: 0 };
  const pilLine = textFromBytes(bytes, pos, pilBreak);
  pos = pilBreak + 3;

  // Validate it looks like a real WMO header
  if (!wmoLine.match(/^[A-Z]{4}\d{2}\s+[A-Z]{4}/)) {
    return { dataOffset: 0 };
  }

  const parts = wmoLine.split(/\s+/);

  return {
    wmoHeader: {
      raw: wmoLine + '\n' + pilLine,
      wmoId: parts[0] || '',
      station: parts[1] || '',
      datetime: parts[2] || '',
      awipsPil: pilLine,
      dataOffset: pos,
    },
    dataOffset: pos,
  };
}

function textFromBytes(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}
