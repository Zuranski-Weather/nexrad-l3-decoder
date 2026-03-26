import type { NexradProduct } from './types';

/** Geographic location and altitude of a single radar gate. */
export interface GateLocation {
  /** Latitude in degrees (+N / -S). */
  latitude: number;
  /** Longitude in degrees (+E / -W). */
  longitude: number;
  /** Altitude above mean sea level in meters. */
  altitudeMsl: number;
  /** Great-circle ground distance from radar in km. */
  groundRangeKm: number;
}

/**
 * Raster grid for products that use rectangular display format (e.g. Composite Reflectivity 37/38).
 * The grid is row-major with row 0 at the north edge.  Each cell holds a 16-level color code (0–15).
 * Code 0 = no precipitation, code 1 = range folded, codes 2–15 = increasing data values.
 */
export interface RasterData {
  /** Number of rows (north–south). */
  rows: number;
  /** Number of columns (west–east). */
  cols: number;
  /** Flat row-major grid of 4-bit color codes (0–15). Access: grid[row * cols + col]. */
  grid: Uint8Array;
  /** Horizontal resolution in km per pixel (west-to-east). */
  kmPerPixelX: number;
  /** Vertical resolution in km per pixel (north-to-south). */
  kmPerPixelY: number;
  /** Row index of the radar center within the grid. */
  radarRow: number;
  /** Column index of the radar center within the grid. */
  radarCol: number;
}

/** One radial of gate data. */
export interface RadialData {
  /** Center azimuth of the radial in degrees clockwise from true north. */
  azimuthDeg: number;
  /** Angular width of the radial in degrees. */
  azimuthWidthDeg: number;
  /** Raw 8-bit gate codes. Code 0 = below threshold, 1 = range folded, 2-255 = data. */
  bins: Uint8Array;
}

/** Decoded NEXRAD Level 3 product with all data needed for visualization. */
export interface Level3Product {
  /** NEXRAD product code (e.g. 153 for N0B). */
  productCode: number;
  /** Human-readable product name. */
  productName: string;

  /** Radar latitude in degrees (+N / -S). */
  radarLatitude: number;
  /** Radar longitude in degrees (+E / -W). */
  radarLongitude: number;
  /** Radar antenna height above MSL in meters. */
  radarHeightMsl: number;

  /** Elevation angle in degrees. */
  elevationAngle: number;
  /** Elevation cut number within the VCP. */
  elevationNumber: number;
  /** Volume Coverage Pattern number. */
  vcp: number;
  /** Operational mode (e.g. "Precipitation / Severe Weather"). */
  operationalMode: string;

  /** Volume scan start time. */
  volumeScanTime: Date;
  /** Product generation time. */
  productGeneratedTime: Date;

  /**
   * Distance between gate centers in km (0.25 for super-res, 1.0 for standard).
   */
  gateResolutionKm: number;
  /**
   * Slant range to the near edge of the first gate in km.
   * Center of gate g: firstGateRangeKm + (g + 0.5) * gateResolutionKm
   */
  firstGateRangeKm: number;
  /** Number of gates (bins) per radial. */
  numberOfGates: number;

  /** Ordered radial data, or null if the product has no digital radial packet. */
  radials: RadialData[] | null;
  /** Number of radials (0 if no radial data). */
  numberOfRadials: number;

  /**
   * Raster grid for products that use rectangular display format (e.g. Composite Reflectivity 37/38).
   * Present when the product has a raster packet (0xBA07/0xBA0F) and no radial data.
   */
  rasterData?: RasterData;

  /** Number of distinct data levels in this product.
   * - `256` — digital 256-level product: use `gateValue(code)` with a continuous palette.
   * - `16`  — legacy 16-level product (e.g. Composite Reflectivity 37/38): use the level index
   *           `code - 2` (range 0–13) with a discrete 14-step palette rather than the absolute
   *           dBZ value from `gateValue()`, because the raw thresholds may span a narrow range
   *           that falls entirely within a single color band (e.g. −28 to +3 dBZ in clear-air mode).
   */
  numDataLevels: number;
  /** Physical unit string (e.g. "dBZ", "m/s"). Empty if unknown. */
  unit: string;
  /**
   * Convert a raw gate code to its physical value.
   * Returns null for below-threshold (0) and range-folded (1).
   */
  gateValue(code: number): number | null;

  /**
   * Compute the geographic location of a point at a given azimuth and slant range.
   * Uses the 4/3 effective earth radius beam propagation model.
   */
  gateLocation(azimuthDeg: number, slantRangeKm: number): GateLocation;

  /** Whether this file was SBN/zlib-wrapped (NOAAPORT distribution format). */
  sbnZlibWrapped: boolean;

  /** WMO header info, if present. */
  wmoHeader?: { wmoId: string; station: string; awipsPil: string };

  /** Full raw parsed product for advanced access. */
  raw: NexradProduct;
}
