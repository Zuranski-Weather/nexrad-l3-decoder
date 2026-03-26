# NEXRAD Level 3 Decoder

A lightweight, browser-native library for decoding and visualizing NEXRAD Level 3 radar products. Pure client-side processing with no dependencies.

A public NEXRAD Level 3 viewer using this decoder is available here: https://zuranskiweather.com/tools/nexrad-l3-viewer/

## Overview

This library parses binary NEXRAD Level 3 products and exposes:
- **Product metadata** (radar location, elevation, timing, operational mode)
- **Radial sweep data** (azimuth, range bins, raw gate codes)
- **Physical value conversion** (gate codes → dBZ, m/s, etc.)
- **Geographic coordinates** (lat/lon/altitude for every gate using 4/3 earth radius beam propagation)
- **Web visualization** (interactive polar canvas with pan/zoom, hover inspection)

## Features

- **Pure client-side**: No server needed, no upload of data
- **Transparent format handling**: Automatically detects and unwraps SBN/NOAAPORT zlib-wrapped products
- **Compressed data support**: Decompresses bzip2-compressed symbology blocks (vendored decompressor)
- **Precision coordinates**: 4/3 effective earth radius model for accurate beam location
- **Standard color scales**: NWS base reflectivity palette; generic min-max gradients for other products
- **Interactive visualization**: Pan, zoom, hover for gate inspection
- **Zero-copy data access**: Direct Uint8Array gate codes for custom analysis

## Installation

As an npm package:
```bash
npm install nexrad-l3-decoder
```

## Quick Start

### Basic Decoding

```javascript
import { decodeLevel3 } from 'nexrad-l3-decoder';

// Load a NEXRAD Level 3 file (ArrayBuffer)
const buffer = await fetch('/path/to/N0B.bin').then(r => r.arrayBuffer());

// Decode
const product = await decodeLevel3(buffer, 'N0B.bin');

// Access metadata
console.log(product.productName);           // "Super Res Digital Base Reflectivity (N0B)"
console.log(product.radarLatitude);         // e.g., 41.413°N
console.log(product.radarLongitude);        // e.g., -81.860°E
console.log(product.elevationAngle);        // e.g., 0.5°
console.log(product.unit);                  // "dBZ"

// Iterate radials and gates
for (const radial of product.radials) {
  console.log(`Azimuth: ${radial.azimuthDeg.toFixed(1)}°`);

  for (let g = 0; g < radial.bins.length; g++) {
    const code = radial.bins[g];
    const value = product.gateValue(code);  // null = below threshold/range folded; number = physical value

    if (value !== null) {
      const rangeKm = product.firstGateRangeKm + (g + 0.5) * product.gateResolutionKm;
      const location = product.gateLocation(radial.azimuthDeg, rangeKm);

      console.log(`  Gate ${g}: ${value.toFixed(1)} ${product.unit} @ ${location.latitude.toFixed(4)}°N, ${location.longitude.toFixed(4)}°E, ${location.altitudeMsl.toFixed(0)}m MSL`);
    }
  }
}
```

### Per-Gate Inspection API

```javascript
// Convert code 42 to physical value
const dbz = product.gateValue(42);

// Get lat/lon/altitude for a point
const location = product.gateLocation(
  180,  // azimuth in degrees (0° = north, clockwise)
  25.5  // slant range in km
);

console.log(`${location.latitude}° N`);
console.log(`${location.longitude}° E`);
console.log(`${location.altitudeMsl} m MSL`);
console.log(`${location.groundRangeKm} km (great-circle distance from radar)`);
```

### WMO/AWIPS Header Access

```javascript
if (product.wmoHeader) {
  console.log(product.wmoHeader.wmoId);    // e.g., "SDUS51"
  console.log(product.wmoHeader.station);  // e.g., "KCLE"
  console.log(product.wmoHeader.awipsPil); // e.g., "N0BKCLE"
}

// Check if file was SBN/NOAAPORT-wrapped
if (product.sbnZlibWrapped) {
  console.log("This was a zlib-compressed NOAAPORT SBN product");
}
```

## API Reference

### `decodeLevel3(buffer, fileName?): Promise<Level3Product>`

Main entry point. Decodes a NEXRAD Level 3 ArrayBuffer.

**Parameters:**
- `buffer` (ArrayBuffer): Raw binary NEXRAD Level 3 product
- `fileName` (string, optional): Original filename (for debugging)

**Returns:** Promise resolving to a `Level3Product`

**Throws:** Error if buffer is not a valid Level 3 product

### Level3Product Interface

```typescript
interface Level3Product {
  // Product info
  productCode: number;                           // e.g., 153 for N0B
  productName: string;                           // Human-readable name

  // Radar location
  radarLatitude: number;                         // degrees (+N / -S)
  radarLongitude: number;                        // degrees (+E / -W)
  radarHeightMsl: number;                        // meters above sea level

  // Elevation
  elevationAngle: number;                        // degrees
  elevationNumber: number;                       // cut number within VCP
  vcp: number;                                   // Volume Coverage Pattern

  // Timing
  volumeScanTime: Date;                          // When volume scan started
  productGeneratedTime: Date;                    // When product was created
  operationalMode: string;                       // "Precipitation / Severe Weather", etc.

  // Gate dimensions
  gateResolutionKm: number;                      // 0.25 (super-res) or 1.0
  firstGateRangeKm: number;                      // Slant range to near edge of first gate
  numberOfGates: number;                         // Gates per radial
  numberOfRadials: number;                       // Number of radials (0-720 typical)

  // Data
  radials: RadialData[] | null;                  // Ordered array, or null if no radial data
  unit: string;                                  // "dBZ", "m/s", "in", "", etc.

  // Helper functions
  gateValue(code: number): number | null;        // Convert code→physical value
  gateLocation(azimuthDeg, slantRangeKm): GateLocation;  // Compute lat/lon/alt

  // Metadata
  sbnZlibWrapped: boolean;                       // NOAAPORT SBN format flag
  wmoHeader?: { wmoId, station, awipsPil };     // Optional header info
  raw: NexradProduct;                            // Full parser output (advanced)
}
```

### RadialData Interface

```typescript
interface RadialData {
  azimuthDeg: number;          // Center azimuth (0° = north, clockwise)
  azimuthWidthDeg: number;     // Angular width (typically ~0.5° for 360 radials)
  bins: Uint8Array;            // Raw 8-bit gate codes
}

// Gate codes:
// 0   = Below threshold
// 1   = Range folded
// 2-255 = Data: use product.gateValue(code) for physical value
```

### GateLocation Interface

```typescript
interface GateLocation {
  latitude: number;            // degrees (+N / -S)
  longitude: number;           // degrees (+E / -W)
  altitudeMsl: number;         // meters above mean sea level
  groundRangeKm: number;       // Great-circle distance from radar
}
```

## Supported Products

The library handles any NEXRAD Level 3 product with digital radial packets (Packet Code 16). Common products include:

| Code | Name | Unit | Gate Res. | Notes |
|------|------|------|-----------|-------|
| 19, 20 | Base Reflectivity | dBZ | 1 km | Standard product |
| 27, 56, 99 | Base Velocity | m/s | 1 km, 250m (99) | Radial velocity |
| 28, 30, 155 | Spectrum Width | m/s | 1 km, 250m (155) | Velocity spread |
| 32 | DHR (Hybrid Scan) | dBZ | 1 km | Climatology-adjusted |
| 41, 135 | Echo Tops | kft | – | Single value per radial |
| 78, 79, 80, 81, 138 | Precipitation | in | 1 km, 2 km | Accumulated rainfall |
| 94 | Base Reflectivity (N0Q) | dBZ | 1 km | Standard 0.5° data |
| 153, 154, 155 | Super Res Reflectivity/Velocity/Width | dBZ / m/s | 250 m | Enhanced resolution |
| 159, 161, 163, 165, 167, 168 | Dual-Pol Products | dB, deg, – | 250 m | Correlation, phase, etc. |

Products not in this list may parse but won't have threshold data for physical value conversion.

## Coordinate System & Beam Propagation

The library uses the **4/3 effective earth radius model** for accurate beam propagation:

1. **Elevation angle** → beam bends following refractivity lapse rate
2. **Slant range** + elevation → height above radar
3. **Azimuth** + ground range → lat/lon via great-circle forward

Formula:
```
h = sqrt(r² + (4/3·Re)² + 2·r·(4/3·Re)·sin(elev)) - 4/3·Re

where:
  r = slant range from radar
  elev = elevation angle
  Re = 6371 km (mean earth radius)
```

This model is standard in meteorology and provides ±50m accuracy for ranges < 200 km.

## Browser Support

- **Modern browsers** (ES2020 or later): Works out of the box
- **Decompress API**: Requires `DecompressionStream` (Chrome 80+, Firefox 107+, Safari 16.4+)
  - For older browsers, replace with a zlib polyfill (e.g., `pako`)

## File Format Notes

### Standard Level 3 Format

```
[WMO preamble: ~60 bytes]
→ [Message Header: 18 HW]
→ [Product Description: ~102 HW]
→ [Symbology Block (optional, usually bzip2-compressed)]
→ [Graphic Alpha (optional)]
→ [Tabular Alpha (optional)]
```

### SBN/NOAAPORT Wrapped Format

Some sources distribute Level 3 products wrapped in zlib-compressed SBN frames:

```
[WMO preamble]
→ [Zlib stream]
   ├─ [SBN CCB header]
   ├─ [WMO copy]
   └─ [L3 headers up to symbology block offset]
→ [Remaining bzip2 data (outside zlib)]
```

The library automatically detects and reconstructs these.

## Troubleshooting

**"Not a valid NEXRAD Level 3 product"**
- Check file format (should be binary, not text)
- Verify WMO header is present or file starts with correct message code
- File may be corrupted or truncated

**"No digital radial packet found"**
- Product may contain only text/graphic overlays (no numeric data)
- Try a different product code or elevation

**"Invalid azimuth lookup"**
- Radials may span < 360° or have gaps; inspect `product.radials`

**Canvas doesn't render**
- Check browser console for errors
- Ensure `DecompressionStream` is available (or provide zlib polyfill)

## License & Attribution

This project is licensed under the **GNU General Public License v3.0**.

### What This Means

- ✅ **Academic use**: Free to use, modify, and share within academia
- ✅ **Improvements stay open**: Any modifications must be released under GPLv3
- ✅ **Full attribution**: Your contributions are credited throughout the ecosystem
- ❌ **Commercial proprietary use**: Companies cannot create closed-source derivatives

### Citation & Credit

We ask that academic publications using these libraries include:

Mike Zuranski. Zuranski Weather LLC. 2026. Available at: [github.com/Zuranski-Weather/nexrad-l3-decoder](https://github.com/Zuranski-Weather/nexrad-l3-decoder)

### Upstream Data and Data Sources

This library implements the NEXRAD Level 3 format as documented in the NOAA ICD (Interface Control Document).

- [NEXRAD Level 3 Product ICD](https://www.roc.noaa.gov/interface-control-documents.php)

Data sources used to develop and test this decoder include the following:

- [NOAA/NSF Unidata AWS S3 Bucket](https://registry.opendata.aws/noaa-nexrad/)
- [NWS Telecommunications Gateway](https://www.weather.gov/tg/radfiles)
