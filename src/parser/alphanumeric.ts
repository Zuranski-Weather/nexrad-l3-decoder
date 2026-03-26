import { BinaryReader } from './utils';
import { parsePackets } from './packets';
import { parseMessageHeader, parseProductDescription } from './header';
import type { GraphicAlphanumericBlock, TabularAlphanumericBlock, AlphanumericPage } from '../types';

export function parseGraphicAlphanumericBlock(
  fullBuffer: ArrayBuffer,
  messageStartOffset: number,
  graphicOffsetHalfwords: number,
): GraphicAlphanumericBlock | undefined {
  if (graphicOffsetHalfwords === 0) return undefined;

  const offset = messageStartOffset + graphicOffsetHalfwords * 2;
  const reader = new BinaryReader(fullBuffer, offset);

  const divider = reader.readInt16();
  if (divider !== -1) return undefined;

  const blockId = reader.readUint16();
  const blockLength = reader.readUint32();
  const numberOfPages = reader.readUint16();

  const pages: AlphanumericPage[] = [];
  for (let p = 0; p < numberOfPages; p++) {
    const pageNumber = reader.readUint16();
    const pageLength = reader.readUint16();
    const pageEnd = reader.offset + pageLength;
    const packets = parsePackets(reader, pageEnd);

    const text: string[] = [];
    for (const pkt of packets) {
      if ('text' in pkt && typeof pkt.text === 'string') {
        text.push(pkt.text);
      }
    }
    pages.push({ pageNumber, text });
    reader.seek(pageEnd);
  }

  return { blockId, blockLength, numberOfPages, pages };
}

export function parseTabularAlphanumericBlock(
  fullBuffer: ArrayBuffer,
  messageStartOffset: number,
  tabularOffsetHalfwords: number,
): TabularAlphanumericBlock | undefined {
  if (tabularOffsetHalfwords === 0) return undefined;

  const offset = messageStartOffset + tabularOffsetHalfwords * 2;
  const reader = new BinaryReader(fullBuffer, offset);

  const divider = reader.readInt16();
  if (divider !== -1) return undefined;

  const blockId = reader.readUint16();
  const blockLength = reader.readUint32();

  // Second Message Header and Product Description Block
  const secondHeader = parseMessageHeader(reader);
  const secondPd = parseProductDescription(reader);

  // Pages of ASCII data, separated by -1 dividers
  const pageDivider = reader.readInt16();
  if (pageDivider !== -1) return { blockId, blockLength, secondHeader, secondProductDescription: secondPd, numberOfPages: 0, pages: [] };

  const numberOfPages = reader.readUint16();
  const pages: string[][] = [];

  for (let p = 0; p < numberOfPages; p++) {
    const lines: string[] = [];
    // Each page has lines of 80-char ASCII, terminated by -1 divider
    while (reader.remaining() >= 2) {
      const check = reader.peekInt16();
      if (check === -1) {
        reader.skip(2);
        break;
      }
      // Read 80 bytes of text
      if (reader.remaining() >= 80) {
        const line = reader.readString(80).trimEnd();
        lines.push(line);
      } else {
        break;
      }
    }
    pages.push(lines);
  }

  return { blockId, blockLength, secondHeader, secondProductDescription: secondPd, numberOfPages, pages };
}
