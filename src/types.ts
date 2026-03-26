export interface WmoHeader {
  raw: string;
  wmoId: string;
  station: string;
  datetime: string;
  awipsPil: string;
  dataOffset: number;
}

export interface MessageHeader {
  messageCode: number;
  dateOfMessage: number;
  timeOfMessage: number;
  messageDate: Date;
  lengthOfMessage: number;
  sourceId: number;
  destinationId: number;
  numberOfBlocks: number;
}

export interface ProductDescription {
  blockDivider: number;
  latitude: number;
  longitude: number;
  radarHeight: number;
  productCode: number;
  operationalMode: number;
  operationalModeName: string;
  vcp: number;
  sequenceNumber: number;
  volumeScanNumber: number;
  volumeScanDate: number;
  volumeScanTime: number;
  volumeScanDateTime: Date;
  productGenDate: number;
  productGenTime: number;
  productGenDateTime: Date;
  p1: number;
  p2: number;
  elevationNumber: number;
  p3: number;
  dataLevelThresholds: number[];
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  version: number;
  spotBlank: number;
  symbologyOffset: number;
  graphicOffset: number;
  tabularOffset: number;
  compressionMethod: number;
  uncompressedSize: number;
}

export interface DataStatistics {
  totalBins: number;
  belowThreshold: number;
  rangeFolded: number;
  validBins: number;
  minCode: number;
  maxCode: number;
  minValue: number;
  maxValue: number;
  meanValue: number;
  unit: string;
  histogram: Map<number, number>;
}

export interface Radial {
  startAngle: number;
  angleDelta: number;
  numBytes: number;
  bins: Uint8Array;
}

export interface RadialPacket {
  packetCode: number;
  indexOfFirstRangeBin: number;
  numberOfRangeBins: number;
  iCenter: number;
  jCenter: number;
  scaleFactor: number;
  numberOfRadials: number;
  radials: Radial[];
}

export interface RleRadial {
  startAngle: number;
  angleDelta: number;
  numHalfwords: number;
  runs: Array<{ run: number; color: number }>;
}

export interface RleRadialPacket {
  packetCode: number;
  indexOfFirstRangeBin: number;
  numberOfRangeBins: number;
  iCenter: number;
  jCenter: number;
  scaleFactor: number;
  numberOfRadials: number;
  radials: RleRadial[];
}

export interface RasterRow {
  numBytes: number;
  runs: Array<{ run: number; color: number }>;
}

export interface RasterPacket {
  packetCode: number;
  opFlags: number;
  iStart: number;
  jStart: number;
  xScaleInt: number;
  xScaleFrac: number;
  yScaleInt: number;
  yScaleFrac: number;
  numberOfRows: number;
  packingDescriptor: number;
  rows: RasterRow[];
}

export interface TextPacket {
  packetCode: number;
  colorLevel?: number;
  iStart: number;
  jStart: number;
  text: string;
}

export interface GenericPacket {
  packetCode: number;
  reserved: number;
  dataLength: number;
  rawData: Uint8Array;
}

export interface UnknownPacket {
  packetCode: number;
  rawLength: number;
  description: string;
}

export type DataPacket =
  | RadialPacket
  | RleRadialPacket
  | RasterPacket
  | TextPacket
  | GenericPacket
  | UnknownPacket;

export interface DataLayer {
  layerLength: number;
  packets: DataPacket[];
}

export interface SymbologyBlock {
  blockId: number;
  blockLength: number;
  numberOfLayers: number;
  layers: DataLayer[];
  compressed: boolean;
  compressedSize?: number;
  uncompressedSize?: number;
}

export interface AlphanumericPage {
  pageNumber: number;
  text: string[];
}

export interface GraphicAlphanumericBlock {
  blockId: number;
  blockLength: number;
  numberOfPages: number;
  pages: AlphanumericPage[];
}

export interface TabularAlphanumericBlock {
  blockId: number;
  blockLength: number;
  secondHeader?: MessageHeader;
  secondProductDescription?: ProductDescription;
  numberOfPages: number;
  pages: string[][];
}

export interface NexradProduct {
  fileName: string;
  fileSize: number;
  wmoHeader?: WmoHeader;
  messageHeader: MessageHeader;
  productDescription: ProductDescription;
  productName: string;
  symbology?: SymbologyBlock;
  graphicAlphanumeric?: GraphicAlphanumericBlock;
  tabularAlphanumeric?: TabularAlphanumericBlock;
  dataStatistics?: DataStatistics;
  thresholdInfo?: ThresholdInfo;
  sbnZlibWrapped?: boolean;
}

export interface ThresholdInfo {
  type: 'digital' | 'legacy' | 'generic';
  minValue: number;
  increment: number;
  numLevels: number;
  unit: string;
  codeToValue: (code: number) => number | null;
}
