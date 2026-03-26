import { BinaryReader } from './utils';
import { detectAndStripWmoHeader } from './wmo';
import { parseMessageHeader, parseProductDescription, buildThresholdInfo, PRODUCT_NAMES } from './header';
import { parseSymbologyBlock } from './symbology';
import { parseGraphicAlphanumericBlock, parseTabularAlphanumericBlock } from './alphanumeric';
import type { NexradProduct, DataStatistics, RadialPacket, RleRadialPacket, RasterPacket, ThresholdInfo } from '../types';

export function parseNexradLevel3(buffer: ArrayBuffer, fileName: string): NexradProduct {
  // Step 1: Detect and strip WMO header
  const { wmoHeader, dataOffset } = detectAndStripWmoHeader(buffer);

  // Step 2: Parse Message Header
  const reader = new BinaryReader(buffer, dataOffset);
  const messageStartOffset = dataOffset;
  const messageHeader = parseMessageHeader(reader);

  // Step 3: Parse Product Description Block
  const productDescription = parseProductDescription(reader);

  // Step 4: Get product name
  const productName = PRODUCT_NAMES[Math.abs(productDescription.productCode)]
    || `Unknown Product (Code ${productDescription.productCode})`;

  // Step 5: Build threshold info
  const thresholdInfo = buildThresholdInfo(productDescription);

  // Step 6: Parse Symbology Block (with bzip2 decompression if needed)
  let symbology;
  try {
    symbology = parseSymbologyBlock(
      buffer,
      messageStartOffset,
      productDescription.symbologyOffset,
      productDescription.compressionMethod,
      productDescription.uncompressedSize,
      messageHeader.lengthOfMessage,
    );
  } catch (err) {
    console.error('Error parsing symbology block:', err);
  }

  // Step 7: Parse Graphic Alphanumeric Block (if not compressed - compression covers all remaining data)
  let graphicAlphanumeric;
  if (productDescription.compressionMethod !== 1) {
    try {
      graphicAlphanumeric = parseGraphicAlphanumericBlock(
        buffer,
        messageStartOffset,
        productDescription.graphicOffset,
      );
    } catch (err) {
      console.error('Error parsing graphic alphanumeric block:', err);
    }
  }

  // Step 8: Parse Tabular Alphanumeric Block (if not compressed)
  let tabularAlphanumeric;
  if (productDescription.compressionMethod !== 1) {
    try {
      tabularAlphanumeric = parseTabularAlphanumericBlock(
        buffer,
        messageStartOffset,
        productDescription.tabularOffset,
      );
    } catch (err) {
      console.error('Error parsing tabular alphanumeric block:', err);
    }
  }

  // Step 9: Compute data statistics from radial data
  const dataStatistics = computeDataStatistics(symbology?.layers, thresholdInfo);

  return {
    fileName,
    fileSize: buffer.byteLength,
    wmoHeader,
    messageHeader,
    productDescription,
    productName,
    symbology,
    graphicAlphanumeric,
    tabularAlphanumeric,
    dataStatistics,
    thresholdInfo,
  };
}

function computeDataStatistics(
  layers: { packets: any[] }[] | undefined,
  thresholdInfo?: ThresholdInfo,
): DataStatistics | undefined {
  if (!layers) return undefined;

  let totalBins = 0;
  let belowThreshold = 0;
  let rangeFolded = 0;
  let validBins = 0;
  let minCode = 256;
  let maxCode = -1;
  let sum = 0;
  const histogram = new Map<number, number>();

  for (const layer of layers) {
    for (const packet of layer.packets) {
      if (packet.packetCode === 16 && 'radials' in packet) {
        const radPkt = packet as RadialPacket;
        for (const radial of radPkt.radials) {
          for (let i = 0; i < radial.bins.length; i++) {
            const code = radial.bins[i];
            totalBins++;
            histogram.set(code, (histogram.get(code) || 0) + 1);

            if (code === 0) {
              belowThreshold++;
            } else if (code === 1) {
              rangeFolded++;
            } else {
              validBins++;
              if (code < minCode) minCode = code;
              if (code > maxCode) maxCode = code;
              sum += code;
            }
          }
        }
      } else if (packet.packetCode === 0xaf1f && 'radials' in packet) {
        const rlePkt = packet as RleRadialPacket;
        for (const radial of rlePkt.radials) {
          for (const run of radial.runs) {
            const code = run.color;
            const count = run.run;
            totalBins += count;
            histogram.set(code, (histogram.get(code) || 0) + count);

            if (code === 0) {
              belowThreshold += count;
            } else if (code === 1) {
              rangeFolded += count;
            } else {
              validBins += count;
              if (code < minCode) minCode = code;
              if (code > maxCode) maxCode = code;
              sum += code * count;
            }
          }
        }
      } else if ((packet.packetCode === 0xba07 || packet.packetCode === 0xba0f) && 'rows' in packet) {
        const rasterPkt = packet as RasterPacket;
        for (const row of rasterPkt.rows) {
          for (const run of row.runs) {
            const code = run.color;
            const count = run.run;
            totalBins += count;
            histogram.set(code, (histogram.get(code) || 0) + count);

            if (code === 0) {
              belowThreshold += count;
            } else if (code === 1) {
              rangeFolded += count;
            } else {
              validBins += count;
              if (code < minCode) minCode = code;
              if (code > maxCode) maxCode = code;
              sum += code * count;
            }
          }
        }
      }
    }
  }

  if (totalBins === 0) return undefined;

  let minValue = 0, maxValue = 0, meanValue = 0;
  const unit = thresholdInfo?.unit || '';

  if (thresholdInfo && validBins > 0) {
    minValue = thresholdInfo.codeToValue(minCode) ?? 0;
    maxValue = thresholdInfo.codeToValue(maxCode) ?? 0;
    const meanCode = sum / validBins;
    meanValue = thresholdInfo.codeToValue(Math.round(meanCode)) ?? 0;
  }

  return {
    totalBins,
    belowThreshold,
    rangeFolded,
    validBins,
    minCode: minCode > 255 ? 0 : minCode,
    maxCode: maxCode < 0 ? 0 : maxCode,
    minValue,
    maxValue,
    meanValue,
    unit,
    histogram,
  };
}
