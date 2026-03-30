import { BinaryReader, mjdToDate } from './utils';
import type { MessageHeader, ProductDescription, ThresholdInfo } from '../types';

/** Reconstruct an IEEE 754 float32 from two big-endian int16 halfwords (MSW, LSW). */
function halfwordsToFloat(msw: number, lsw: number): number {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint16(0, msw & 0xffff, false);
  view.setUint16(2, lsw & 0xffff, false);
  return view.getFloat32(0, false);
}

/**
 * Decode a 16-bit modified IEEE float used by DVL/EET products (ICD §3.3.4 Figure 3-6 Note 1).
 * Layout: S(1) E(5) F(10)
 *   E = 0:  value = (-1)^S × 2 × (F / 1024)
 *   E > 0:  value = (-1)^S × 2^(E-16) × (1 + F / 1024)
 */
function decode16BitFloat(hw: number): number {
  const u = hw & 0xFFFF;
  const S = (u >> 15) & 1;
  const E = (u >> 10) & 0x1F;
  const F = u & 0x3FF;
  if (E === 0) return (S ? -1 : 1) * 2 * (F / 1024);
  return (S ? -1 : 1) * (2 ** (E - 16)) * (1 + F / 1024);
}

const OP_MODES: Record<number, string> = {
  0: 'Maintenance',
  1: 'Clear Air',
  2: 'Precipitation / Severe Weather',
};

// Products using digital 256-level threshold encoding (HW31=minVal*10, HW32=increment*10, HW33=numLevels)
// NOTE: Products 37 and 38 (Composite Reflectivity) are intentionally excluded: they use raster
// packets (0xBA07/0xBA0F) with 16-level per-code legacy thresholds, NOT the min/inc/numLevels format.
const DIGITAL_THRESHOLD_PRODUCTS = new Set([
  // Legacy WSR-88D radial/area products using min/inc/numLevels encoding in product description
  19, 20, 27, 30, 32, 41, 43, 44, 45, 46, 50, 51, 57,
  78, 79, 80, 81, 86, 87, 90, 94, 97, 98, 99,
  // Digital products (134+) — int16 min/inc/nLevels encoding
  135, 138, 153, 154, 155, 193, 195,
  // TDWR products — int16 encoding
  180, 182, 186,
]);

// Products using float32 Scale/Offset threshold encoding per ICD §3.3.4:
//   HW31-32 = Scale (IEEE float32), HW33-34 = Offset (IEEE float32)
//   Value = (Code - Offset) / Scale
const FLOAT_THRESHOLD_PRODUCTS = new Set([
  // Dual-pol products
  159, 161, 163, 167, 168,
  // Digital precipitation products
  170, 172, 173, 174, 175, 176,
  // QVP products
  189, 190, 191, 192,
]);

// Hydrometeor classification products: gate codes ARE the category identifiers directly.
// No scale/offset applies — codes 10, 20, 30 … 100 each map to a hydrometeor type.
// Both products use bzip2-compressed symbology and packet code 16 (digital radial).
const HC_CATEGORICAL_PRODUCTS = new Set([
  165, // Digital Hydrometeor Classification (HCA / N0H / N1H / N2H / N3H)
  177, // Hybrid Hydrometeor Classification (HHC)
]);

// Product 134 (DVL) uses a custom piecewise linear/log encoding with 16-bit float coefficients.
// Coefficients are stored in HW31-35 using a modified 16-bit IEEE float format:
//   S(1 bit) E(5 bits) F(10 bits)
//   E=0: value = (-1)^S * 2 * (F/1024)
//   E>0: value = (-1)^S * 2^(E-16) * (1 + F/1024)
const DVL_PRODUCT = 134;

export function parseMessageHeader(reader: BinaryReader): MessageHeader {
  const messageCode = reader.readInt16();
  const dateOfMessage = reader.readUint16();
  const timeOfMessage = reader.readUint32();
  const lengthOfMessage = reader.readUint32();
  const sourceId = reader.readUint16();
  const destinationId = reader.readUint16();
  const numberOfBlocks = reader.readUint16();

  return {
    messageCode,
    dateOfMessage,
    timeOfMessage,
    messageDate: mjdToDate(dateOfMessage, timeOfMessage),
    lengthOfMessage,
    sourceId,
    destinationId,
    numberOfBlocks,
  };
}

export function parseProductDescription(reader: BinaryReader): ProductDescription {
  const blockDivider = reader.readInt16();
  const latitude = reader.readInt32() / 1000;
  const longitude = reader.readInt32() / 1000;
  const radarHeight = reader.readInt16();
  const productCode = reader.readInt16();
  const operationalMode = reader.readInt16();
  const vcp = reader.readInt16();
  const sequenceNumber = reader.readInt16();
  const volumeScanNumber = reader.readInt16();
  const volumeScanDate = reader.readUint16();
  const volumeScanTime = reader.readUint32();
  const productGenDate = reader.readUint16();
  const productGenTime = reader.readUint32();
  const p1 = reader.readInt16();
  const p2 = reader.readInt16();
  const elevationNumber = reader.readInt16();
  const p3 = reader.readInt16();

  const dataLevelThresholds: number[] = [];
  for (let i = 0; i < 16; i++) {
    dataLevelThresholds.push(reader.readInt16());
  }

  const p4 = reader.readInt16();
  const p5 = reader.readInt16();
  const p6 = reader.readInt16();
  const p7 = reader.readInt16();
  const p8 = reader.readInt16();
  const p9 = reader.readInt16();
  const p10 = reader.readInt16();

  const versionSpot = reader.readUint16();
  const version = (versionSpot >> 8) & 0xff;
  const spotBlank = versionSpot & 0xff;

  const symbologyOffset = reader.readUint32();
  const graphicOffset = reader.readUint32();
  const tabularOffset = reader.readUint32();

  const compressionMethod = p8;
  const uncompressedSize = ((p9 & 0xffff) << 16) | (p10 & 0xffff);

  return {
    blockDivider,
    latitude,
    longitude,
    radarHeight,
    productCode,
    operationalMode,
    operationalModeName: OP_MODES[operationalMode] || `Unknown (${operationalMode})`,
    vcp,
    sequenceNumber,
    volumeScanNumber,
    volumeScanDate,
    volumeScanTime,
    volumeScanDateTime: mjdToDate(volumeScanDate, volumeScanTime),
    productGenDate,
    productGenTime,
    productGenDateTime: mjdToDate(productGenDate, productGenTime),
    p1,
    p2,
    elevationNumber,
    p3,
    dataLevelThresholds,
    p4,
    p5,
    p6,
    p7,
    p8,
    p9,
    p10,
    version,
    spotBlank,
    symbologyOffset,
    graphicOffset,
    tabularOffset,
    compressionMethod,
    uncompressedSize,
  };
}

export function buildThresholdInfo(pd: ProductDescription): ThresholdInfo | undefined {
  const code = Math.abs(pd.productCode);
  const t = pd.dataLevelThresholds;

  // Hydrometeor classification: gate codes are category IDs (10, 20, 30 … 100).
  // No scale/offset encoding — return the code value directly.
  if (HC_CATEGORICAL_PRODUCTS.has(code)) {
    return {
      type: 'generic',
      minValue: 10,
      increment: 10,
      numLevels: 256,
      unit: '',
      codeToValue: (c: number) => {
        if (c === 0 || c === 1) return null;
        return c; // category code IS the value
      },
    };
  }

  // DVL (product 134): piecewise linear/log encoding per ICD §3.3.4.
  // HW31-32 encode linear scale/offset as 16-bit floats, HW33 is the log start code,
  // HW34-35 encode log scale/offset. For codes < HW33: VIL = (code - linOffset) / linScale.
  // For codes >= HW33: VIL = exp((code - logOffset) / logScale).
  if (code === DVL_PRODUCT) {
    const linScale = decode16BitFloat(t[0]);   // HW31
    const linOffset = decode16BitFloat(t[1]);   // HW32
    const logStart = t[2];                      // HW33 (plain int, not float-encoded)
    const logScale = decode16BitFloat(t[3]);    // HW34
    const logOffset = decode16BitFloat(t[4]);   // HW35
    const unit = getUnitForProduct(code);

    return {
      type: 'generic',
      minValue: 0,
      increment: 0,
      numLevels: 256,
      unit,
      codeToValue: (c: number) => {
        if (c === 0 || c === 1 || c === 255) return null; // below threshold / flagged / reserved
        if (c < logStart) {
          // Linear region
          return linScale !== 0 ? (c - linOffset) / linScale : null;
        }
        // Log region
        return logScale !== 0 ? Math.exp((c - logOffset) / logScale) : null;
      },
    };
  }

  if (FLOAT_THRESHOLD_PRODUCTS.has(code)) {
    // Float32 Scale/Offset encoding: HW31-32 = Scale, HW33-34 = Offset
    // Each pair of int16 halfwords forms an IEEE 754 float32
    const scale = halfwordsToFloat(t[0], t[1]);
    const offset = halfwordsToFloat(t[2], t[3]);
    const unit = getUnitForProduct(code);

    return {
      type: 'generic',
      minValue: scale !== 0 ? (2 - offset) / scale : 0,
      increment: scale !== 0 ? 1 / scale : 0,
      numLevels: 256,
      unit,
      codeToValue: (c: number) => {
        if (c === 0) return null; // below threshold
        if (c === 1) return null; // range folded / missing
        if (scale === 0) return null;
        return (c - offset) / scale;
      },
    };
  }

  if (DIGITAL_THRESHOLD_PRODUCTS.has(code)) {
    const minVal = t[0]; // already scaled by 10
    const increment = t[1]; // already scaled by 10
    const numLevels = t[2];
    const unit = getUnitForProduct(code);

    return {
      type: 'digital',
      minValue: minVal / 10,
      increment: increment / 10,
      numLevels,
      unit,
      codeToValue: (c: number) => {
        if (c === 0) return null; // below threshold
        if (c === 1) return null; // range folded / missing
        return (minVal + (c - 2) * increment) / 10;
      },
    };
  }

  // Legacy 16-level products: the 16 data level thresholds encode the value
  // for each color level (0-15). Bits in each halfword:
  //   bit 0-7:  magnitude (unsigned)
  //   bit 8:    sign (1 = negative)
  //   bit 9:    decimal fraction flag (divide by 10)
  //   bit 13:   "below threshold" marker
  //   bit 14:   "range folded" marker
  // If none of the special flags are set, the threshold is a real value.
  const unit = getUnitForProduct(code);
  const decodedLevels = t.map(decodeLegacyThreshold);
  // Only produce legacy info if at least one threshold carries a real value
  if (decodedLevels.some((v) => v !== null)) {
    return {
      type: 'legacy',
      minValue: 0,
      increment: 1,
      numLevels: 16,
      unit,
      codeToValue: (c: number) => {
        if (c < 0 || c >= 16) return null;
        return decodedLevels[c];
      },
    };
  }

  return undefined;
}

/**
 * Decode a legacy 16-level data threshold halfword per ICD §3.3.4, Figure 3-6.
 *
 * Bit layout (standard bit numbering, 0 = LSB):
 *   bits  0–7  : magnitude (unsigned byte)
 *   bit   8  (0x0100): "-" negative sign
 *   bit   9  (0x0200): "+" positive sign modifier (explicit positive; no effect on value)
 *   bit  10  (0x0400): "<" less-than modifier
 *   bit  11  (0x0800): ">" greater-than modifier
 *   bit  12  (0x1000): scale-by-10 flag (divide magnitude by 10)
 *   bit  13  (0x2000): scale-by-20 flag
 *   bit  14  (0x4000): scale-by-100 flag
 *   bit  15  (0x8000): special-encoding flag — when set AND no numeric flag bits (8–14) are
 *                       set, the low byte is a text qualifier code that yields no numeric
 *                       value: 0=BLANK, 1=TH (below threshold), 2=ND (no data),
 *                       3=RF (range folded), etc.
 * Returns the physical value or null for special markers (below threshold, range folded).
 */
function decodeLegacyThreshold(hw: number): number | null {
  // Bit 15 set with no numeric flags → low byte is a text-qualifier code (TH, RF, ND…) → null
  if ((hw & 0x8000) !== 0 && (hw & 0x7f00) === 0) return null;
  const magnitude = hw & 0xff;
  const negative = (hw & 0x0100) !== 0; // bit 8 = "-" negative sign
  let value = negative ? -magnitude : magnitude;
  if (hw & 0x1000) value /= 10; // bit 12 = scale-by-10 (1 decimal place)
  return value;
}

function getUnitForProduct(code: number): string {
  // Reflectivity products (WSR-88D and TDWR)
  if ([19, 20, 32, 37, 38, 86, 87, 90, 94, 97, 137, 153, 180, 185, 186, 189, 193, 195].includes(code)) return 'dBZ';
  // Velocity products (WSR-88D and TDWR)
  if ([27, 43, 44, 50, 51, 98, 99, 154, 181, 182, 183, 190].includes(code)) return 'm/s';
  // Storm-relative velocity (legacy 16-level, values in knots)
  if (code === 56) return 'kts';
  // Spectrum width
  if ([28, 30, 155, 191].includes(code)) return 'm/s';
  // VIL
  if ([57, 134].includes(code)) return 'kg/m²';
  // Echo tops
  if ([41, 135].includes(code)) return 'kft';
  // Precipitation / accumulation
  if ([78, 79, 80, 81, 138, 169, 170, 171, 172, 173, 174, 175].includes(code)) return 'in';
  // Precipitation rate
  if ([176].includes(code)) return 'in/hr';
  // Differential reflectivity (ZDR)
  if ([159].includes(code)) return 'dB';
  // Correlation coefficient (CC) — dimensionless
  if ([161, 167].includes(code)) return '';
  // Specific differential phase (KDP)
  if ([163, 168, 192].includes(code)) return 'deg/km';
  // Hydrometeor classification / melting layer — categorical
  if ([165, 166, 177].includes(code)) return '';
  // Wind profile / superob
  if ([136].includes(code)) return 'kts';
  // Snow water equivalent
  if ([144, 146, 150].includes(code)) return 'in';
  // Snow depth
  if ([145, 147, 151].includes(code)) return 'in';
  // TDWR shear
  if ([187].includes(code)) return '/s';
  // Severe weather reflectivity/velocity/shear (legacy 16-level)
  if ([45, 46].includes(code)) return 'm/s';
  // Microburst AMDA
  if ([196].includes(code)) return 'kts';
  // Digital Base Reflectivity DOD variant
  if ([199].includes(code)) return 'dBZ';
  return '';
}

export const PRODUCT_NAMES: Record<number, string> = {
  19: 'Base Reflectivity (R)',
  20: 'Base Reflectivity (R)',
  27: 'Base Velocity (V)',
  28: 'Base Spectrum Width (SW)',
  30: 'Base Spectrum Width (SW)',
  32: 'Digital Hybrid Scan Reflectivity (DHR)',
  37: 'Composite Reflectivity (CR)',
  38: 'Composite Reflectivity (CR)',
  41: 'Echo Tops (ET)',
  43: 'Severe Weather Reflectivity (SWR)',
  44: 'Severe Weather Velocity (SWV)',
  45: 'Severe Weather Spectrum Width (SWW)',
  46: 'Severe Weather Shear (SWS)',
  50: 'Cross Section Reflectivity',
  51: 'Cross Section Velocity',
  56: 'Storm Relative Mean Velocity (SRM)',
  57: 'Vertically Integrated Liquid (VIL)',
  58: 'Storm Tracking Information (STI)',
  59: 'Hail Index (HI)',
  61: 'Tornado Vortex Signature (TVS)',
  62: 'Storm Structure (SS)',
  78: 'One-Hour Rainfall Accumulation (OHP)',
  79: 'Three-Hour Rainfall Accumulation (THP)',
  80: 'Storm Total Rainfall Accumulation (STP)',
  81: 'Hourly Digital Precipitation Array (DPA)',
  82: 'Supplemental Precipitation Data (SPD)',
  86: 'Cross Section Reflectivity (CS)',
  87: 'Cross Section Velocity (CS)',
  90: 'Layer Composite Reflectivity',
  94: 'Base Reflectivity Data Array (N0Q)',
  97: 'Composite Reflectivity Edited for AP',
  98: 'Super Resolution Base Velocity (N1U)',
  99: 'Base Velocity Data Array (N0U)',
  134: 'High Resolution VIL (DVL)',
  135: 'Enhanced Echo Tops (EET)',
  136: 'SuperOb (for VAD Wind Profile)',
  137: 'User Selectable Layer Composite Reflectivity',
  138: 'Digital Storm Total Precipitation (DSP)',
  141: 'Mesocyclone Detection (MD)',
  143: 'TVS Rapid Update',
  144: 'One-Hour Snow Water Equivalent',
  145: 'One-Hour Snow Depth',
  146: 'Storm Total Snow Water Equivalent',
  147: 'Storm Total Snow Depth',
  149: 'Digital Mesocyclone Detection',
  150: 'User Selectable Snow Water Equivalent',
  151: 'User Selectable Snow Depth',
  152: 'Archive III Status Product',
  153: 'Super Res Digital Base Reflectivity (N0B)',
  154: 'Super Res Digital Base Velocity (N0G)',
  155: 'Super Res Digital Base Spectrum Width (N0W)',
  159: 'Digital Differential Reflectivity (ZDR)',
  161: 'Digital Correlation Coefficient (CC)',
  163: 'Digital Specific Differential Phase (KDP)',
  165: 'Digital Hydrometeor Classification (HC)',
  166: 'Melting Layer',
  167: 'Super Res Digital Correlation Coefficient',
  168: 'Super Res Digital Specific Diff Phase',
  169: 'One-Hour Accumulation (OHA)',
  170: 'Digital Accumulation Array (DAA)',
  171: 'Storm Total Accumulation (STA)',
  172: 'Digital Storm Total Accumulation (DSA)',
  173: 'Digital User-Selectable Accumulation (DUA)',
  174: 'Digital One-Hour Difference Accumulation',
  175: 'Digital Storm Total Difference Accumulation',
  176: 'Digital Instantaneous Precipitation Rate (DPR)',
  177: 'Hybrid Hydrometeor Classification (HHC)',
  // TDWR products
  180: 'TDWR Base Reflectivity',
  181: 'TDWR Base Velocity (TV0)',
  182: 'TDWR Base Velocity (TV1)',
  183: 'TDWR Base Velocity (TV2)',
  185: 'TDWR Base Reflectivity (TZ0)',
  186: 'TDWR Long Range Base Reflectivity',
  187: 'TDWR Base Spectrum Width',
  // QVP and other products
  189: 'Quasi-Vertical Profile Reflectivity',
  190: 'Quasi-Vertical Profile Velocity',
  191: 'Quasi-Vertical Profile Spectrum Width',
  192: 'Quasi-Vertical Profile Specific Diff Phase',
  193: 'Super Res DQA Base Reflectivity',
  195: 'Digital Base Reflectivity DOD',
  196: 'Microburst AMDA',
  199: 'Digital Base Reflectivity',
  202: 'Shift Change Checklist',
};
