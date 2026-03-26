# Visualization & High-Performance Rendering Guide

This document outlines how to extend the basic interactive canvas visualization for production-grade, high-power data exploration.

## Current Visualization Architecture

### Canvas-Based Approach (src/ui/visualization.ts)

**Strengths:**
- Pure JavaScript, no dependencies
- Fast for single product at moderate zoom
- Real-time pan/zoom
- Simple to understand and debug

**Limitations:**
- 2D only (single elevation slice)
- ~250k pixel iterations per render
- No vector layer support (wind barbs, contours)
- Hard to integrate base maps or geographic overlays
- Difficult to implement advanced features (measurement tools, cross-sections)

### Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Decode + decompress | 50–150 ms | Mostly bzip2 |
| Render ImageData | 15–40 ms | 500×500 canvas, ~250k pixels |
| Canvas blit + overlays | < 2 ms | Trivial on modern GPU |
| Gate lookup (hover) | < 0.1 ms | 0.1° LUT hit-test |

## Path 1: Enhanced Canvas Renderer (Easiest)

### Scope
Improve the existing visualization without architectural change.

### Tasks

1. **Better zoom performance**
   - Render at lower resolution during drag, full resolution on release
   - Use `requestAnimationFrame` for smooth interaction
   - Implement zoom levels (5×, 10×) with pre-rendered tiles

2. **Overlay support**
   - Grid/projections (lat/lon, mercator)
   - Reticle/range rings with dynamic labeling
   - Bearing/distance measurement tool
   - Radial/range cursor lines

3. **Additional data display**
   - Sweep animation (load multiple elevations, play sequentially)
   - Value histogram on sidebar
   - Statistics (mean, stddev, percentiles)
   - Min/max pin markers

4. **Export capabilities**
   - PNG snapshot of current view
   - GeoTIFF of full sweep (requires gridding)
   - CSV export of hovered gate

### Implementation Notes

- Modify `renderVisualization()` function signature to return an object with methods:
  ```ts
  {
    canvas: HTMLCanvasElement,
    addOverlay(name: string, draw: (ctx) => void): void,
    exportPNG(): Blob,
    exportGeoTIFF(): Promise<Blob>,
    setData(product: Level3Product): void,
    destroy(): void  // cleanup handlers
  }
  ```

- Overlay interface:
  ```ts
  type OverlayRenderer = (ctx: CanvasRenderingContext2D, state: {
    panX: number, panY: number, zoom: number,
    scale: number, SIZE: number
  }) => void
  ```

- Require `DrawingML` or `Leaflet` plugins for map integration

## Path 2: WebGL / Three.js Renderer (Recommended for Power Users)

### Characteristics
- **Scalability**: Handle multiple products, large datasets
- **Flexibility**: Custom shaders, 3D visualization, layering
- **Integration**: Works with Mapbox GL, Deck.gl, Cesium

### Architecture

```
┌─────────────────────────────────────────────┐
│  Level3Product[] (loaded from decodeLevel3) │
└────────────┬────────────────────────────────┘
             │
      ┌──────v──────┐
      │ Data Processor
      │ (gridding, resampling, animation)
      └──────┬──────┘
             │
      ┌──────v──────────────────┐
      │ WebGL Texture Uploader  │
      │ (GPU memory, mipmaps)   │
      └──────┬──────────────────┘
             │
      ┌──────v──────────────────────────┐
      │ Renderer (Three.js / Deck.gl)   │
      │ (shaders, lighting, compositing)│
      └──────┬──────────────────────────┘
             │
      ┌──────v──────────────────────────┐
      │ Interactive View (pan, zoom,    │
      │ timeline, tools)                │
      └─────────────────────────────────┘
```

### Implementation Example: Three.js

```javascript
import * as THREE from 'three';
import { decodeLevel3 } from 'nexrad-l3-decoder';

class RadarVolumeRenderer {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      -200, 200, 200, -200, 0.1, 1000
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    container.appendChild(this.renderer.domElement);

    // Gate data as point cloud
    this.pointGeometry = null;
    this.pointCloud = null;
  }

  async load(buffer, fileName) {
    const product = await decodeLevel3(buffer, fileName);

    // Build points + colors from radials
    const positions = [];
    const colors = [];
    const colorTable = this.buildColorTable(product);

    for (const radial of product.radials) {
      for (let g = 0; g < radial.bins.length; g++) {
        const code = radial.bins[g];
        if (code < 2) continue; // skip no-data

        const value = product.gateValue(code);
        if (value === null) continue;

        const range = product.firstGateRangeKm + (g + 0.5) * product.gateResolutionKm;
        const { latitude, longitude, altitudeMsl } = product.gateLocation(
          radial.azimuthDeg, range
        );

        // ECEF or simple XYZ (adjust to match map projection)
        positions.push(longitude, latitude, altitudeMsl / 1000);

        // Color from value
        const [r, g, b] = this.getColorRGB(value, product.unit);
        colors.push(r / 255, g / 255, b / 255);
      }
    }

    if (this.pointCloud) this.scene.remove(this.pointCloud);
    this.pointGeometry = new THREE.BufferGeometry();
    this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.pointGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));

    const material = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      sizeAttenuation: true
    });
    this.pointCloud = new THREE.Points(this.pointGeometry, material);
    this.scene.add(this.pointCloud);

    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  buildColorTable(product) {
    // Return function(dBz) -> [R, G, B]
  }

  getColorRGB(value, unit) {
    // Map physical value to color
  }
}
```

### GPU Acceleration Features

1. **Texture-based rendering**
   - Bake gate positions + values into textures
   - Use custom shader to render with volumetric effects

2. **Compute shaders** (WebGL 2 / WebGPU)
   - Offline interpolation grid from sparse radial data
   - Gaussian smoothing, contouring
   - Cross-section extraction

3. **Instancing**
   - Render multiple products at different elevations in one draw call

## Path 3: Deck.gl Renderer (Best for Maps)

### Setup

```javascript
import {ScatterplotLayer, GeoJsonLayer} from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { decodeLevel3 } from 'nexrad-l3-decoder';

// Convert Level3Product to GeoJSON FeatureCollection
function productToGeoJSON(product) {
  const features = [];

  for (const radial of product.radials) {
    for (let g = 0; g < radial.bins.length; g++) {
      const code = radial.bins[g];
      if (code < 2) continue;

      const value = product.gateValue(code);
      if (value === null) continue;

      const range = product.firstGateRangeKm + (g + 0.5) * product.gateResolutionKm;
      const loc = product.gateLocation(radial.azimuthDeg, range);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [loc.longitude, loc.latitude, loc.altitudeMsl]
        },
        properties: {
          value,
          code,
          azimuth: radial.azimuthDeg,
          range,
          color: getColorForValue(value, product.unit)
        }
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// Render in Deck.gl
export function RadarMap({ productBuffer }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    decodeLevel3(productBuffer).then(product => {
      setData(productToGeoJSON(product));
    });
  }, [productBuffer]);

  if (!data) return <div>Loading...</div>;

  return (
    <DeckGL
      initialViewState={{
        longitude: -81.86,
        latitude: 41.41,
        zoom: 7,
        pitch: 45
      }}
      controller
      layers={[
        new ScatterplotLayer({
          data: data.features,
          getPosition: d => d.geometry.coordinates,
          getFillColor: d => d.properties.color,
          getRadius: 500,
          radiusUnits: 'meters',
          pickable: true,
          onHover: (info) => console.log(info.object?.properties)
        })
      ]}
    />
  );
}
```

### Advantages
- Integrates with real map (satellite imagery, other layers)
- 3D support (tilt, lighting)
- Large dataset performance
- Community ecosystem

## Path 4: Cesium.js Renderer (Enterprise GIS)

### Use Case
Full 3D globe with multiple radar products, terrain, and vector overlays.

```javascript
import * as Cesium from 'cesium';
import { decodeLevel3 } from 'nexrad-l3-decoder';

async function addRadarProduct(viewer, buffer) {
  const product = await decodeLevel3(buffer);

  for (const radial of product.radials) {
    for (let g = 0; g < radial.bins.length; g++) {
      const code = radial.bins[g];
      if (code < 2) continue;

      const value = product.gateValue(code);
      if (value === null) continue;

      const range = product.firstGateRangeKm + (g + 0.5) * product.gateResolutionKm;
      const loc = product.gateLocation(radial.azimuthDeg, range);

      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          loc.longitude, loc.latitude, loc.altitudeMsl
        ),
        point: {
          pixelSize: 4,
          color: Cesium.Color.fromCssColorString(
            getColorHex(value, product.unit)
          ),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 0.5
        },
        properties: {
          value: value.toFixed(1),
          unit: product.unit,
          dBZ: value
        }
      });
    }
  }
}
```

## Performance Comparison

| Approach | Render Speed | Memory | Scalability | Integration |
|----------|--------------|--------|-------------|-------------|
| Canvas | Instant | Low | Single product | Custom only |
| Three.js | 60 FPS | Medium | Multi-product, GPU | Game engines, 3D apps |
| Deck.gl | 60 FPS | Medium | Large datasets, GPU | Maps, web apps |
| Cesium | 60 FPS | High | Enterprise | GIS systems, globe |

## Recommended Path Forward

1. **Phase 1**: Enhance canvas renderer (Path 1) — 2-3 days
   - Better UX (zoom, grid, measurement tools)
   - Export PNG/GeoTIFF
   - Stays pure JavaScript

2. **Phase 2**: Add Web Worker for decoding — 1 day
   - Offload bzip2 to background thread
   - Non-blocking file loading for large batches

3. **Phase 3**: Deck.gl integration — 3-5 days
   - Real map support
   - Multi-product overlay
   - Large-scale visualization

4. **Phase 4**: GPU-accelerated rendering — 1–2 weeks
   - Compute shaders for gridding/contouring
   - Volumetric visualization
   - Performance for <1s latency on 100+ products

## Color Scale Considerations

For extensibility:
1. **Define color mapper interface**
   ```ts
   interface ColorMapper {
     mapValue(value: number, unit: string): [r, g, b, a];
   }
   ```

2. **Implement standard scales**
   - NWS reflectivity (existing)
   - AFWA standard suite
   - User-defined diverging/sequential scales

3. **Support discrete + continuous**
   ```ts
   // Discrete: 16 NWS steps
   // Continuous: smooth gradient interpolation
   ```

## Testing Strategy for Visualizers

1. **Reference imagery**: Use NOAA archive data with known patterns
2. **Synthetic data**: Generate test products with known gate values
3. **Benchmarking**: Profile rendering at 1000×1000, 2000×2000 resolutions
4. **Visual regression**: Compare snapshots across versions

## Future Extensions

- **Dual-pol visualization**: ZDR + ρhv pseudo color
- **Animation timelines**: Play through multiple elevations/times
- **Cross-section**: Slice through 3D volume
- **Contouring**: Overlay contours of reflectivity
- **Storm tracking**: Feature detection + correlation
- **Custom shaders**: Let users define visualization
