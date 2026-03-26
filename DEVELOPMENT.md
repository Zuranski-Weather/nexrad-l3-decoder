# Development Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Public Library API                         │
│  decodeLevel3(buffer) → Level3Product                        │
│  createGateLocator() / getGateResolutionKm()                │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         v                v                v
    src/decode.ts   src/geo.ts     src/api-types.ts
    (orchestrator)   (physics)      (public types)
         │                │                │
         └────────────────┼────────────────┘
                          │
         ┌────────────────┼────────────────────────────┐
         v                v                             v
 src/parser/            src/ui/              src/resolution.ts
 (binary parsing)    (visualization)        (product metadata)
 · index.ts          · visualization.ts
 · header.ts         · summary.ts
 · symbology.ts      · detail.ts
 · preprocess.ts
 · bz2.ts (vendor)
```

### Layer Responsibilities

**API Layer** (`src/decode.ts`, `src/index.ts`)
- Entry point: `decodeLevel3()`
- Orchestrates preprocessing + parsing
- Converts raw `NexradProduct` → `Level3Product`
- Assembles metadata, builds helper closures

**Parser Layer** (`src/parser/`)
- Binary format parsing (WMO header, message header, product description, symbology blocks)
- Handles both standard and SBN/zlib-wrapped formats
- Decompresses bzip2 data (vendored decompressor)
- Returns fully-parsed `NexradProduct` tree

**Physics Layer** (`src/geo.ts`, `src/resolution.ts`)
- 4/3 earth radius beam propagation model
- Great-circle coordinate transformation
- Gate spacing lookup by product code

**Visualization Layer** (`src/ui/visualization.ts`)
- Interactive canvas radar display
- Pan/zoom with coordinate tracking
- Gate hover inspection with lat/lon lookup

## Directory Structure

```
src/
├── index.ts                  # Library barrel (public exports)
├── decode.ts                 # Main entry point, orchestrator
├── api-types.ts              # Public type definitions
├── geo.ts                    # Beam propagation + coordinate math
├── resolution.ts             # Gate spacing by product code
│
├── parser/
│   ├── index.ts              # parseNexradLevel3()
│   ├── header.ts             # Message/product header parsing, thresholds
│   ├── symbology.ts          # Symbology block + layer/packet parsing
│   ├── preprocess.ts         # SBN zlib unwrapping
│   ├── bz2.ts                # Vendored bzip2 decompressor (ESM)
│   └── graphics.ts           # Graphic/tabular alphanumeric blocks
│
├── ui/
│   ├── visualization.ts      # Interactive polar canvas
│   ├── summary.ts            # Product metadata card
│   ├── detail.ts             # Expandable Layer/Packet inspector
│   └── ...
│
├── types.ts                  # Internal type definitions (NexradProduct tree)
├── style.css                 # Styling
└── main.ts                   # Web app entry point (loads file, renders UI)

dist/
├── index.html                # Web app (vite build)
└── lib/
    ├── nexrad-l3-decoder.js  # Library bundle (lib build)
    └── *.d.ts                # TypeScript declarations
```

## Key Algorithms

### 1. Binary Block Parsing

**Message Header** (18 halfwords @ offset 0)
```
Offset  Size   Field
0       2 HW   Message code
2       2 HW   Date (days since 1970-01-01)
4       2 HW   Time (seconds since midnight UTC)
6       2 HW   Message length (HW)
8       2 HW   Source ID
10      2 HW   Destination ID
12      2 HW   Number of blocks
14      4 HW   (reserved)
```

**Product Description** (~102 HW)
```
Offset  Field
0-10    Radar location & height
18-20   Date/time (MJD + seconds)
26      Product code (signed int16)
28-30   Thresholds (16 HW for level scaling)
...
74      Symbology block offset (HW)
76      Graphic block offset (HW)
78      Tabular block offset (HW)
80      Compression method (0=none, 1=bzip2)
```

Uses `BinaryReader` class (offset tracking, endianness).

### 2. Symbology Block Decompression

**Compressed Format** (when p8 = 1):
```
Offset  Field
0       Block ID (1)
2       Number of layers
4-5     Divider (-1 or 0x00FF for compressed)
6+      [if compressed: bzip2 stream starts here]
```

**Key fix**: Compressed products start with divider `0x00FF` (255 as int16), not `0xFFFF` (-1). This is consistent across all bzip2-compressed products. The symbology block structure remains unchanged after this divider.

### 3. Radial Packet (Code 16) Parsing

```
Offset     Field
0          Packet code (16)
2          Index of first range bin
4          Number of range bins
6          i-coordinate of center
8          j-coordinate of center
10         Scale factor
12         Number of radials
14+        Radial data

Radial structure:
  2 HW     Start angle (0.1° resolution)
  2 HW     Angle delta (0.1° resolution)
  2 HW     Number of bytes (gate codes)
  n bytes  Raw 8-bit gate codes
```

Azimuth centers at `startAngle + angleDelta / 2` degrees from true north (0°), clockwise.

### 4. Gate Code → Physical Value Conversion

From product description thresholds (HW 31-46):
```
minVal = dataLevelThresholds[0] / 10
increment = dataLevelThresholds[1] / 10
numLevels = dataLevelThresholds[2]

codeToValue(c):
  if c == 0: return null (below threshold)
  if c == 1: return null (range folded)
  if c >= 2: return (minVal + c * increment)
```

**Example**: N0B (product 153)
- Thresholds: [–640, 50, 256]
- minVal = –64, increment = 5
- Code 2 → –64 + 2×5 = –54 dBZ
- Code 100 → –64 + 100×5 = 436 dBZ

### 5. Beam Propagation (4/3 Earth Radius Model)

Given:
- Radar position: (latRad, lonRad, heightKm MSL)
- Elevation angle: elevRad
- Azimuth: azRad (0 = north, clockwise)
- Slant range: r (km)

Step 1: Height above radar
```
h_above_radar = sqrt(r² + (KE·Re)² + 2·r·KE·Re·sin(elev)) - KE·Re
  where KE = 4/3, Re = 6371 km
```

Step 2: Altitude MSL
```
altitude_msl = (h_above_radar + heightKm) × 1000 (convert to meters)
```

Step 3: Great-circle ground range
```
ground_range = KE·Re · arcsin(r·cos(elev) / (KE·Re + h_above_radar))
```

Step 4: Great-circle forward transform
```
angular_dist = ground_range / Re
lat2 = asin(sin(lat1)·cos(d) + cos(lat1)·sin(d)·cos(az))
lon2 = lon1 + atan2(sin(az)·sin(d)·cos(lat1), cos(d) - sin(lat1)·sin(lat2))
```

Precomputed in `createGateLocator()` closure for speed.

### 6. SBN/Zlib Unwrapping

NOAAPORT SBN format:
```
[WMO preamble + WMO binary envelope]
→ zlib stream (deflate) containing:
   [SBN CCB header ~180 bytes]
   + [WMO copy]
   + [L3 message header]
   + [L3 product description]
   + [partial symbology block header (up to divider)]
→ [Remaining raw bzip2 data (outside zlib)]
```

**Algorithm** (`tryUnwrapSbnZlib`):
1. Detect: zlib magic bytes `0x78 [0x01, 0x5E, 0x9C, 0xDA]` at WMO offset
2. Decompress: Use `DecompressionStream('deflate')`, catching trailing-byte errors
3. Find L3 start: Scan backwards in decompressed data for `CRCRLF` (0x0D 0x0D 0x0A) + non-ASCII
4. Read message length from L3 header (bytes 8–12, BE uint32)
5. Compute Adler-32 of decompressed data, search raw file for that 4-byte checksum to locate zlib boundary
6. Reconstruct: WMO preamble + L3 from zlib + raw bzip2 continuation (limited by messageLength)

This allows seamless handling of both standard and NOAAPORT-wrapped products.

### 7. NWS Reflectivity Color Scale

Discrete palette with 16 levels:
```
dBZ → RGB
-30: (100, 100, 100)     # Gray
  5: (4, 233, 231)       # Cyan
 10: (1, 159, 244)       # Light blue
 15: (3, 0, 244)         # Blue
 20: (2, 253, 2)         # Bright green
 25: (1, 197, 1)         # Green
 30: (0, 142, 0)         # Dark green
 35: (253, 248, 2)       # Yellow
 40: (229, 188, 0)       # Orange-yellow
 45: (253, 149, 0)       # Orange
 50: (253, 0, 0)         # Red
 55: (212, 0, 0)         # Dark red
 60: (188, 0, 0)         # Very dark red
 65: (248, 0, 253)       # Magenta
 70: (152, 84, 198)      # Purple
 75: (253, 253, 253)     # White
```

Non-dBZ products use a generic gradient: blue → cyan → green → yellow → red.

### 8. Canvas Rendering (src/ui/visualization.ts)

**Offscreen pass** (once per product):
1. Create 500×500 ImageData
2. For each pixel (px2, py):
   - Convert to data-space offset from radar center
   - Compute azimuth + slant range (inverse polar)
   - Hit-test against 0.1° azimuth LUT (Int16Array[3600]) → radial index
   - Compute gate index from slant range
   - Look up color in precomputed 256-entry RGBA table
   - Write to ImageData

**Screen rendering** (on every interaction):
1. Blit offscreen with pan/zoom transform (ctx.translate/scale)
2. Draw overlays (range rings, cardinal labels, radar dot) in screen space

**Interaction**:
- Hover: Convert cursor pixel → data-space → az/range → radial + gate → display in sidebar
- Drag: Pan offset (Δx, Δy) tracked on `window` mousemove/mouseup
- Wheel: Zoom toward cursor (pre-zoom data point stays under cursor)

## Testing Strategy

### Unit Tests

Not yet in place, but should test:
- **Binary parsing**: Known header values, thresholds, packet structures
- **Beam propagation**: Known radar/gate → compare against reference implementation
- **Color scaling**: Code → RGB conversions
- **Zlib unwrapping**: Round-trip compress/decompress

### Visual Inspection

Web app: Load each file, visually inspect:
- Metadata card (product name, radar, elevation, VCP)
- Visualization (polar display, range rings, realistic reflectivity pattern)
- Hover info (lat/lon make sense geographically)
- Pan/zoom responsiveness

## Performance Profiling

### Hotspots

1. **bzip2 decompression** (vendored JS): ~50 ms for 330 KB
   - Could optimize with WASM or switch to native `CompressionStream` equivalents if standardized
2. **ImageData pixel iteration**: 500² = 250k pixels scanned
   - Could use GPU compute shader for massive upscaling
3. **Azimuth LUT construction**: O(n) per product, but only done once

### Optimization Opportunities

1. **WASM bzip2**: Reduce decompress time by 5–10×
2. **OffscreenCanvas worker**: Offload rendering to background thread
3. **WebGL overlay rendering**: Replace canvas 2D overlays with GPU primitives
4. **Downsampled preview**: For initial load, show 250×250 while full-resolution renders
5. **Streaming decoding**: For multi-product workflows, decode + render in parallel

## Future Extension Points

### 1. Additional Packet Types

- **RLE Radial Packets** (Code 0xAF1F): 16-level RLE compressed
- **Raster Packets** (0xBA0F, 0xBA07): Grid-based data
- **Vector Packets**: Arrows, wind barbs, etc.

Implementation: Add packet parsers in `src/parser/packets.ts`, extend `DataPacket` union type.

### 2. High-Performance Rendering

For "high-power data visualizer":

**Option A: WebGL**
- Use Deck.gl or Three.js for 2D/3D overlay
- Render gate mesh as textured quads or point cloud
- Support multiple simultaneous products, volume rendering

**Option B: Rasterization**
- Custom GeoTIFF output (GDAL.js or native)
- Integrate with QGIS, ArcGIS, or custom GIS

**Option C: Cloud-based**
- Expose API endpoint for bulk processing
- Store pre-rendered tiles in object storage (S3)
- Stream to web client with Mapbox GL / Leaflet

### 3. Temporal Analytics

- **Time series**: Load multiple volumes, animate sweeps
- **Tracking**: Correlate features across elevations/times
- **Climatology**: Build statistical summaries (percentiles, anomalies)

### 4. Polarimetric Products

Extend threshold parsing for dual-pol products (ZDR, ρhv, Kdp). These use slightly different scaling.

### 5. WSR-88D Archive Integration

- Load from NEXRAD archive (NOAA server / AWS bucket)
- Parse direcory structure (YYYY/MM/DD/STATION/PRODUCT)
- Decode on-the-fly during streaming (range requests)

## Code Conventions

- **TypeScript strict mode**: All code must pass `tsc --strict`
- **File organization**: One main entity per file
- **Naming**: camelCase for functions/vars, PascalCase for types/classes
- **Comments**: Explain *why*, not *what*. Use JSDoc for public APIs.
- **Error messages**: Descriptive, mention file/offset if parsing fails
- **Performance**: Avoid allocations in inner loops; precompute where possible

## Deployment & Distribution

### Web App

```bash
npm run build
# Deploys dist/ to static host
```

### Library (npm)

```bash
npm run build:lib
# Creates dist/lib/nexrad-l3-decoder.js + .d.ts
npm publish
```

Current package.json exports:
```json
{
  "main": "dist/lib/nexrad-l3-decoder.js",
  "types": "dist/lib/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/lib/nexrad-l3-decoder.js",
      "types": "./dist/lib/index.d.ts"
    }
  }
}
```

### Browser Compatibility

- **Target**: ES2020 (async/await, Uint8Array, structured types)
- **DecompressionStream**: Chrome 80+, Firefox 107+, Safari 16.4+
  - Polyfill with `pako` for older browsers

## Debugging Tips

1. **Enable sourcemaps in Vite config** for stack traces
2. **Log packet structures**: Add debug output to parser before each packet type branch
3. **Render gate codes color-mapped**: Pixels show code values directly (useful for finding anomalies)
4. **Compare with Python reference**:
   ```python
   import struct
   with open('file.bin', 'rb') as f:
     msg_code = struct.unpack('>h', f.read(2))[0]
     # ...
   ```
5. **Use hex dump**: `hexdump -C file.bin | head -50` to inspect binary structure

## References

- NEXRAD Level 3 ICD (NWS): [Comprehensive binary format specification](https://www.roc.noaa.gov/interface-control-documents.php)
- NOAA NEXRAD documentation: https://www.ncei.noaa.gov/products/level-3-radar-products
- Beam propagation theory: Doviak & Zrnic, "Doppler Radar and Weather Observations"
- Color scales: NWS directive (standard across meteorology industry)
