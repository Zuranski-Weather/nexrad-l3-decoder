// Main entry point
export { decodeLevel3 } from './decode';

// Public types
export type { Level3Product, RadialData, GateLocation, RasterData } from './api-types';

// Utilities exposed for advanced use
export { createGateLocator } from './geo';
export { getGateResolutionKm } from './resolution';

// Re-export raw parser types for advanced access
export type {
  NexradProduct,
  ProductDescription,
  MessageHeader,
  WmoHeader,
  SymbologyBlock,
  DataLayer,
  DataPacket,
  RadialPacket,
  Radial,
  RleRadialPacket,
  RasterPacket,
  ThresholdInfo,
  DataStatistics,
} from './types';
