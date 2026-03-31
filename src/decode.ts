import type { Level3Product, RadialData, GateLocation, RasterData } from './api-types';
import type { NexradProduct, RadialPacket, RleRadialPacket, RasterPacket } from './types';
import { parseNexradLevel3 } from './parser/index';
import { tryUnwrapSbnZlib } from './parser/preprocess';
import { createGateLocator } from './geo';
import { getGateResolutionKm } from './resolution';
import { PRODUCT_NAMES } from './parser/header';

const FT_TO_M = 0.3048;

const OP_MODE_NAMES: Record<number, string> = {
  0: 'Maintenance',
  1: 'Clear Air',
  2: 'Precipitation / Severe Weather',
};

/**
 * Decode a NEXRAD Level 3 product from a binary buffer.
 *
 * Handles SBN/zlib-wrapped NOAAPORT format automatically.
 * Returns a flat object with all metadata, radial data, and helper
 * functions needed for visualization and data interrogation.
 */
export async function decodeLevel3(
  buffer: ArrayBuffer,
  fileName?: string,
): Promise<Level3Product> {
  let buf = buffer;
  let sbnZlibWrapped = false;

  // Check for SBN/zlib-wrapped NOAAPORT format
  const unwrapped = await tryUnwrapSbnZlib(buf);
  if (unwrapped) {
    buf = unwrapped;
    sbnZlibWrapped = true;
  }

  const raw = parseNexradLevel3(buf, fileName ?? '');
  raw.sbnZlibWrapped = sbnZlibWrapped;

  return buildLevel3Product(raw);
}

/** Expand the 4-bit RLE rows of a raster packet into a flat row-major Uint8Array grid. */
function buildRasterGrid(pkt: RasterPacket, kmPerPixel: number): RasterData {
  const numRows = pkt.numberOfRows;

  // Determine column count from the widest decoded row
  let numCols = 0;
  for (const row of pkt.rows) {
    let c = 0;
    for (const run of row.runs) c += run.run;
    if (c > numCols) numCols = c;
  }

  const kmPerPixelX = kmPerPixel;
  const kmPerPixelY = kmPerPixel;

  const grid = new Uint8Array(numRows * numCols);
  for (let r = 0; r < numRows; r++) {
    let col = 0;
    for (const run of pkt.rows[r].runs) {
      const end = Math.min(col + run.run, numCols);
      grid.fill(run.color, r * numCols + col, r * numCols + end);
      col = end;
    }
  }

  return {
    rows: numRows,
    cols: numCols,
    grid,
    kmPerPixelX,
    kmPerPixelY,
    radarRow: Math.round(numRows / 2),
    radarCol: Math.round(numCols / 2),
  };
}

function buildLevel3Product(raw: NexradProduct): Level3Product {
  const pd = raw.productDescription;
  const productCode = Math.abs(pd.productCode);

  // Find first digital radial packet (code 16), or fall back to RLE radial (0xAF1F)
  let radialPacket: RadialPacket | null = null;
  let rleRadialPacket: RleRadialPacket | null = null;
  if (raw.symbology) {
    for (const layer of raw.symbology.layers) {
      for (const pkt of layer.packets) {
        if (pkt.packetCode === 16 && 'radials' in pkt) {
          radialPacket = pkt as RadialPacket;
          break;
        }
        if (pkt.packetCode === 0xaf1f && 'radials' in pkt && !rleRadialPacket) {
          rleRadialPacket = pkt as RleRadialPacket;
        }
      }
      if (radialPacket) break;
    }
  }

  // Build radial data array
  let radials: RadialData[] | null = null;
  let numberOfRadials = 0;
  let numberOfGates = 0;
  let firstGateIndex = 0;

  if (radialPacket) {
    numberOfRadials = radialPacket.numberOfRadials;
    numberOfGates = radialPacket.numberOfRangeBins;
    firstGateIndex = radialPacket.indexOfFirstRangeBin;
    radials = radialPacket.radials.map((r) => ({
      azimuthDeg: r.startAngle + r.angleDelta / 2,
      azimuthWidthDeg: r.angleDelta,
      bins: r.bins,
    }));
  } else if (rleRadialPacket) {
    // Convert RLE (16-level, 4-bit) radials into 8-bit bin arrays
    numberOfRadials = rleRadialPacket.numberOfRadials;
    numberOfGates = rleRadialPacket.numberOfRangeBins;
    firstGateIndex = rleRadialPacket.indexOfFirstRangeBin;
    radials = rleRadialPacket.radials.map((r) => {
      const bins = new Uint8Array(numberOfGates);
      let idx = 0;
      for (const run of r.runs) {
        for (let j = 0; j < run.run && idx < numberOfGates; j++) {
          bins[idx++] = run.color;
        }
      }
      return {
        azimuthDeg: r.startAngle + r.angleDelta / 2,
        azimuthWidthDeg: r.angleDelta,
        bins,
      };
    });
  }

  // Gate resolution: authoritative table-based lookup.
  // For radial products: km per gate bin. For raster products: km per pixel cell.
  // The raster packet xScaleInt field is a PUP display zoom factor (screen pixels per cell),
  // NOT a physical km/cell value — getGateResolutionKm() is the only accurate source.
  const gateResolutionKm = getGateResolutionKm(productCode);
  const firstGateRangeKm = firstGateIndex * gateResolutionKm;

  // Find raster packet (0xBA07/0xBA0F) when no radial data is present (e.g. products 37, 38)
  let rasterData: RasterData | undefined;
  if (!radials && raw.symbology) {
    for (const layer of raw.symbology.layers) {
      for (const pkt of layer.packets) {
        if ((pkt.packetCode === 0xba07 || pkt.packetCode === 0xba0f) && 'rows' in pkt) {
          rasterData = buildRasterGrid(pkt as RasterPacket, gateResolutionKm);
          break;
        }
      }
      if (rasterData) break;
    }
  }

  // Elevation from p3 (scaled by 10)
  const elevationAngle = pd.p3 / 10;

  // Radar height in meters (stored in feet in the product description)
  const radarHeightMsl = pd.radarHeight * FT_TO_M;

  // Unit and gate value conversion
  const unit = raw.thresholdInfo?.unit ?? '';
  const codeToValue = raw.thresholdInfo?.codeToValue ?? (() => null);
  const numDataLevels = raw.thresholdInfo?.numLevels ?? 256;

  // Gate location closure
  const locator = createGateLocator(
    pd.latitude,
    pd.longitude,
    radarHeightMsl,
    elevationAngle,
  );

  return {
    productCode,
    productName:
      raw.productName ||
      PRODUCT_NAMES[productCode] ||
      `Unknown Product (Code ${productCode})`,

    radarLatitude: pd.latitude,
    radarLongitude: pd.longitude,
    radarHeightMsl,

    elevationAngle,
    elevationNumber: pd.elevationNumber,
    vcp: pd.vcp,
    operationalMode: OP_MODE_NAMES[pd.operationalMode] ?? `Mode ${pd.operationalMode}`,

    volumeScanTime: pd.volumeScanDateTime,
    productGeneratedTime: pd.productGenDateTime,

    gateResolutionKm,
    firstGateRangeKm,
    numberOfGates,

    radials,
    numberOfRadials,
    rasterData,

    unit,
    numDataLevels,
    gateValue: codeToValue,
    gateLocation: (azimuthDeg: number, slantRangeKm: number): GateLocation =>
      locator(azimuthDeg, slantRangeKm),

    sbnZlibWrapped: raw.sbnZlibWrapped ?? false,

    wmoHeader: raw.wmoHeader
      ? {
          wmoId: raw.wmoHeader.wmoId,
          station: raw.wmoHeader.station,
          awipsPil: raw.wmoHeader.awipsPil,
        }
      : undefined,

    raw,
  };
}
