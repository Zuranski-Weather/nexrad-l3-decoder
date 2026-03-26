import type { Level3Product, RasterData } from '../api-types';

const SIZE = 500; // canvas pixel dimensions (drawing buffer)

// NWS standard base reflectivity color table: [minDbz, R, G, B]
const REFL_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-30, 100, 100, 100],
  [  5,   4, 233, 231],
  [ 10,   1, 159, 244],
  [ 15,   3,   0, 244],
  [ 20,   2, 253,   2],
  [ 25,   1, 197,   1],
  [ 30,   0, 142,   0],
  [ 35, 253, 248,   2],
  [ 40, 229, 188,   0],
  [ 45, 253, 149,   0],
  [ 50, 253,   0,   0],
  [ 55, 212,   0,   0],
  [ 60, 188,   0,   0],
  [ 65, 248,   0, 253],
  [ 70, 152,  84, 198],
  [ 75, 253, 253, 253],
];

function reflRgb(dbz: number): [number, number, number] | null {
  if (dbz < REFL_TABLE[0][0]) return null;
  for (let i = REFL_TABLE.length - 1; i >= 0; i--) {
    if (dbz >= REFL_TABLE[i][0]) return [REFL_TABLE[i][1], REFL_TABLE[i][2], REFL_TABLE[i][3]];
  }
  return null;
}

// GR-style CC color palette: [threshold_pct, R, G, B] (ascending, step function)
// Input: physical CC value × 100 (e.g. 0.857 → 85.7)
const CC_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [  0,  84,  84,  84],
  [ 20, 100, 100, 100],
  [ 45,  15,  15, 140],
  [ 60,  10,  10, 190],
  [ 75, 120, 120, 255],
  [ 80,  95, 245, 100],
  [ 85, 135, 215,  10],
  [ 90, 255, 255,   0],
  [ 95, 255, 140,   0],
  [ 97, 225,   3,   0],
  [ 99, 152,  30,  70],
  [ 99.9, 152,  30,  70],
  [100, 255, 180, 215],
  [130, 164,  54, 150],
];

// CC product codes: 161 (Digital CC), 167 (Super Res CC), 190 (QVP CC)
const CC_PRODUCTS = new Set([161, 167, 190]);

// NWS-style velocity color table: [m/s threshold, R, G, B] (step function)
// V-shaped diverging palette: bright green (strong inbound) → dim → gray (zero) → dim → bright red (strong outbound)
const VEL_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-100,   0, 255,   0],   // bright green (strong inbound)
  [ -50,   0, 200,   0],   // medium-bright green
  [ -30,   0, 150,   0],   // medium green
  [ -20,   0, 120,   0],   // medium-dim green
  [ -10,   0,  80,   0],   // dim green (weak inbound)
  [  -3,   0,  50,   0],   // very dim green
  [   0, 180, 180, 180],   // neutral gray (zero velocity)
  [   3,  50,   0,   0],   // very dim red
  [  10,  80,   0,   0],   // dim red (weak outbound)
  [  20, 150,   0,   0],   // medium red
  [  30, 200,   0,   0],   // medium-bright red
  [  50, 255,   0,   0],   // bright red (strong outbound)
];

// Velocity product codes (true Doppler velocity — not spectrum width)
const VEL_PRODUCTS = new Set([27, 43, 44, 50, 51, 56, 98, 99, 154, 181, 182, 183]);

function velRgb(mps: number): [number, number, number] | null {
  for (let i = VEL_TABLE.length - 1; i >= 0; i--) {
    if (mps >= VEL_TABLE[i][0]) return [VEL_TABLE[i][1], VEL_TABLE[i][2], VEL_TABLE[i][3]];
  }
  return null;
}

function ccRgb(pct: number): [number, number, number] | null {
  if (pct < CC_TABLE[0][0]) return null;
  for (let i = CC_TABLE.length - 1; i >= 0; i--) {
    if (pct >= CC_TABLE[i][0]) return [CC_TABLE[i][1], CC_TABLE[i][2], CC_TABLE[i][3]];
  }
  return null;
}

function genericRgb(t: number): [number, number, number] {
  // Blue → Cyan → Green → Yellow → Red
  t = Math.max(0, Math.min(1, t));
  if (t < 0.25) { const s = t * 4;       return [0,               Math.round(s * 255), 255]; }
  if (t < 0.5)  { const s = (t - 0.25) * 4; return [0,               255, Math.round((1 - s) * 255)]; }
  if (t < 0.75) { const s = (t - 0.5) * 4;  return [Math.round(s * 255), 255, 0]; }
  const s = (t - 0.75) * 4;                  return [255, Math.round((1 - s) * 255), 0];
}

/** Pack R,G,B,A into a little-endian uint32 for ImageData (AABBGGRR in memory). */
function pack(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Build a 256-entry lookup from gate code → packed RGBA (0 = transparent). */
function buildColorLookup(product: Level3Product): Uint32Array {
  const table = new Uint32Array(256);
  const isCC = CC_PRODUCTS.has(product.productCode);
  const isVel = VEL_PRODUCTS.has(product.productCode);
  let minV = Infinity, maxV = -Infinity;

  if (product.unit !== 'dBZ' && !isCC && !isVel) {
    for (let c = 2; c < 256; c++) {
      const v = product.gateValue(c);
      if (v !== null) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
    }
  }

  for (let c = 2; c < 256; c++) {
    const v = product.gateValue(c);
    if (v === null) continue;
    let rgb: [number, number, number] | null;
    if (product.unit === 'dBZ') {
      rgb = reflRgb(v);
    } else if (isVel) {
      rgb = velRgb(v);
    } else if (isCC) {
      rgb = ccRgb(v * 100);
    } else {
      rgb = genericRgb(maxV > minV ? (v - minV) / (maxV - minV) : 0.5);
    }
    if (rgb) table[c] = pack(rgb[0], rgb[1], rgb[2]);
  }

  return table;
}

/**
 * Build a 256-entry color lookup for legacy 16-level products (e.g. raster CR 37/38).
 * Maps code index 2–15 directly to the reflectivity color table as discrete steps,
 * so all 14 data levels receive distinct colors regardless of their absolute dBZ value.
 * This matches standard NEXRAD legacy-product display behavior.
 */
function buildLegacy16ColorLookup(): Uint32Array {
  const table = new Uint32Array(256);
  // Code 1 (range folded) → mid-gray
  table[1] = pack(128, 128, 128);
  // Codes 2–15: map proportionally into the reflectivity palette skipping the first gray entry
  // (14 codes mapped across 14 color entries: REFL_TABLE[1] through REFL_TABLE[14])
  for (let c = 2; c <= 15; c++) {
    const [, r, g, b] = REFL_TABLE[c - 1]; // c=2 → entry 1, c=15 → entry 14
    table[c] = pack(r, g, b);
  }
  return table;
}

/** Build a 3600-element (0.1° resolution) azimuth → radial-index lookup. */
function buildAzLookup(radials: NonNullable<Level3Product['radials']>): Int16Array {
  const lut = new Int16Array(3600).fill(-1);
  for (let i = 0; i < radials.length; i++) {
    const { azimuthDeg, azimuthWidthDeg } = radials[i];
    const half = azimuthWidthDeg / 2;
    const start = Math.floor((azimuthDeg - half) * 10);
    const end   = Math.ceil( (azimuthDeg + half) * 10);
    for (let t = start; t <= end; t++) {
      lut[((t % 3600) + 3600) % 3600] = i;
    }
  }
  return lut;
}

/**
 * Render polar radar data to an offscreen canvas via ImageData.
 * Returns the km-to-pixel scale factor.
 */
function renderDataToOffscreen(
  product: Level3Product,
  colors: Uint32Array,
  azLut: Int16Array,
): { offscreen: HTMLCanvasElement; scale: number; maxKm: number } {
  const { radials, firstGateRangeKm, numberOfGates, gateResolutionKm } = product;
  const maxKm = firstGateRangeKm + numberOfGates * gateResolutionKm;
  const scale = (SIZE / 2 - 2) / maxKm;
  const cx = SIZE / 2, cy = SIZE / 2;

  const offscreen = document.createElement('canvas');
  offscreen.width = SIZE;
  offscreen.height = SIZE;
  const ctx = offscreen.getContext('2d')!;

  const img = ctx.createImageData(SIZE, SIZE);
  const px = new Uint32Array(img.data.buffer);
  px.fill(pack(15, 17, 23)); // --bg

  if (!radials || radials.length === 0) {
    ctx.putImageData(img, 0, 0);
    return { offscreen, scale, maxKm };
  }

  for (let py = 0; py < SIZE; py++) {
    for (let px2 = 0; px2 < SIZE; px2++) {
      const dx = px2 - cx, dy = py - cy;
      const km = Math.sqrt(dx * dx + dy * dy) / scale;

      if (km < firstGateRangeKm || km > maxKm) continue;

      // NWS azimuth: 0° = North, clockwise
      let az = Math.atan2(dx, -dy) * (180 / Math.PI);
      if (az < 0) az += 360;

      const ri = azLut[Math.floor(az * 10) % 3600];
      if (ri === -1) continue;

      const gi = Math.floor((km - firstGateRangeKm) / gateResolutionKm);
      if (gi < 0 || gi >= numberOfGates) continue;

      const code = radials[ri].bins[gi];
      if (code >= 2 && colors[code]) px[py * SIZE + px2] = colors[code];
    }
  }

  ctx.putImageData(img, 0, 0);
  return { offscreen, scale, maxKm };
}

/**
 * Render a raster (rectangular grid) product to an offscreen canvas.
 * Row 0 is at the north edge; column 0 is at the west edge.
 */
function renderRasterToOffscreen(
  rasterData: RasterData,
  colors: Uint32Array,
): { offscreen: HTMLCanvasElement; scale: number; maxKm: number } {
  const { rows, cols, grid, kmPerPixelX, kmPerPixelY, radarRow, radarCol } = rasterData;
  const maxKm = Math.max(
    radarRow * kmPerPixelY,
    (rows - radarRow) * kmPerPixelY,
    radarCol * kmPerPixelX,
    (cols - radarCol) * kmPerPixelX,
  );
  const scale = (SIZE / 2 - 2) / maxKm;
  const cx = SIZE / 2, cy = SIZE / 2;

  const offscreen = document.createElement('canvas');
  offscreen.width = SIZE;
  offscreen.height = SIZE;
  const ctx = offscreen.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  const px = new Uint32Array(img.data.buffer);
  px.fill(pack(15, 17, 23));

  for (let py = 0; py < SIZE; py++) {
    for (let px2 = 0; px2 < SIZE; px2++) {
      // Convert screen pixel to km offset from radar (east positive, north positive)
      const eastKm  = (px2 - cx) / scale;
      const northKm = (cy  - py) / scale;
      // Map to grid indices (row increases southward, col increases eastward)
      const gridCol = Math.round(radarCol + eastKm  / kmPerPixelX);
      const gridRow = Math.round(radarRow - northKm / kmPerPixelY);
      if (gridCol < 0 || gridCol >= cols || gridRow < 0 || gridRow >= rows) continue;
      const code = grid[gridRow * cols + gridCol];
      if (code >= 2 && colors[code]) px[py * SIZE + px2] = colors[code];
    }
  }

  ctx.putImageData(img, 0, 0);
  return { offscreen, scale, maxKm };
}

/** Draw overlays (range rings, cardinal labels, radar dot) on the visible canvas. */
function drawOverlays(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,     // screen coords of radar center
  scale: number,              // px per km (already zoom-adjusted)
  maxKm: number,
) {
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';

  const interval = maxKm > 200 ? 100 : 50;
  for (let r = interval; r < maxKm; r += interval) {
    const rPx = r * scale;
    if (rPx < 8) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.stroke();
    // Label in NE quadrant
    const lx = cx + rPx * 0.695 + 2;
    const ly = cy - rPx * 0.695 - 1;
    if (lx > 0 && lx < SIZE && ly > 8 && ly < SIZE) ctx.fillText(`${r}`, lx, ly);
  }
  ctx.setLineDash([]);

  // Radar center dot
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Cardinal labels at the outer ring radius (or canvas edge, whichever is smaller)
  const rOuter = Math.min(SIZE / 2 - 14, maxKm * scale);
  ctx.font = '10px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - rOuter - 2);
  ctx.fillText('S', cx, cy + rOuter + 10);
  ctx.textAlign = 'right';
  ctx.fillText('W', cx - rOuter - 2, cy + 4);
  ctx.textAlign = 'left';
  ctx.fillText('E', cx + rOuter + 2, cy + 4);
  ctx.textAlign = 'start';
}

/** Build the color legend bar. */
function buildLegend(el: HTMLElement, product: Level3Product) {
  // Legacy 16-level products: show discrete swatches with actual threshold dBZ labels
  if (product.numDataLevels === 16 && product.unit === 'dBZ') {
    const strips = [];
    const labels = [];
    for (let c = 2; c <= 15; c++) {
      const v = product.gateValue(c);
      const [, r, g, b] = REFL_TABLE[c - 1];
      const label = v !== null ? v.toFixed(v % 1 === 0 ? 0 : 1) : '—';
      strips.push(`<div class="viz-leg-seg" style="background:rgb(${r},${g},${b});flex:1" title="Code ${c}: ${label} dBZ"></div>`);
      if (c % 2 === 0) labels.push(`<span>${label}</span>`);
    }
    el.innerHTML = `
      <div class="viz-legend-title">dBZ (16-lvl)</div>
      <div class="viz-leg-bar">${strips.join('')}</div>
      <div class="viz-leg-labels">${labels.join('')}</div>
    `;
    return;
  }

  if (product.unit === 'dBZ') {
    const strips = REFL_TABLE.map(([dbz, r, g, b], i) => {
      const next = i + 1 < REFL_TABLE.length ? REFL_TABLE[i + 1][0] : 80;
      return `<div class="viz-leg-seg" style="background:rgb(${r},${g},${b});flex:${next - dbz}" title="${dbz} to ${next} dBZ"></div>`;
    }).join('');

    const labels = REFL_TABLE
      .filter((_, i) => i % 2 === 0)
      .map(([dbz]) => `<span>${dbz}</span>`)
      .join('');

    el.innerHTML = `
      <div class="viz-legend-title">dBZ</div>
      <div class="viz-leg-bar">${strips}</div>
      <div class="viz-leg-labels">${labels}</div>
    `;
    return;
  }

  if (VEL_PRODUCTS.has(product.productCode)) {
    // Clamp display range to actual product min/max
    let minV = Infinity, maxV = -Infinity;
    for (let c = 2; c < 256; c++) {
      const v = product.gateValue(c);
      if (v !== null) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
    }
    const lo = Math.max(Math.floor(minV), VEL_TABLE[0][0]);
    const hi = Math.min(Math.ceil(maxV), 99);

    const strips = VEL_TABLE.map(([mps, r, g, b], i) => {
      if (mps >= hi) return '';
      const rawNext = i + 1 < VEL_TABLE.length ? VEL_TABLE[i + 1][0] : hi;
      const segLo = Math.max(mps, lo);
      const segHi = Math.min(rawNext, hi);
      if (segHi <= segLo) return '';
      return `<div class="viz-leg-seg" style="background:rgb(${r},${g},${b});flex:${segHi - segLo}" title="${mps} to ${rawNext} ${product.unit}"></div>`;
    }).join('');

    const keyVals = VEL_TABLE
      .map(([mps]) => mps)
      .filter(v => v > lo && v < hi && v !== -100);
    const labelsHtml = keyVals.map(v => `<span>${v > 0 ? '+' : ''}${v}</span>`).join('');

    el.innerHTML = `
      <div class="viz-legend-title">${product.unit} &nbsp;<span style="color:#0a0;font-size:0.85em">◀ In</span> / <span style="color:#a00;font-size:0.85em">Out ▶</span></div>
      <div class="viz-leg-bar">${strips}</div>
      <div class="viz-leg-labels">${labelsHtml}</div>
    `;
    return;
  }

  if (CC_PRODUCTS.has(product.productCode)) {
    // Cap legend display at 103% to give the ≥100% strip a reasonable width
    const CAP = 103;
    const strips = CC_TABLE.map(([pct, r, g, b], i) => {
      if (pct >= CAP) return '';
      const rawNext = i + 1 < CC_TABLE.length ? CC_TABLE[i + 1][0] : CAP;
      const next = Math.min(rawNext, CAP);
      const width = Math.max(1, next - pct);
      const label = rawNext > CAP ? `≥${pct}%` : `${pct}% to ${next}%`;
      return `<div class="viz-leg-seg" style="background:rgb(${r},${g},${b});flex:${width}" title="${label}"></div>`;
    }).join('');

    const labels = CC_TABLE
      .filter(([pct]) => pct < CAP && pct !== 99.9)
      .filter((_, i) => i % 2 === 0)
      .map(([pct]) => `<span>${pct}</span>`)
      .join('');

    el.innerHTML = `
      <div class="viz-legend-title">CC (%)</div>
      <div class="viz-leg-bar">${strips}</div>
      <div class="viz-leg-labels">${labels}</div>
    `;
    return;
  }

  el.innerHTML = `<div class="viz-legend-note">Color: min → max ${product.unit || 'value'} (full range)</div>`;
}

const EMPTY_INFO = `<div class="viz-info-ph">Hover over the sweep to inspect gates</div>`;

export function renderVisualization(product: Level3Product): HTMLElement {
  const card = document.createElement('div');
  card.className = 'summary-card';

  const elevStr = `${product.elevationAngle.toFixed(1)}° el`;
  card.innerHTML = `
    <h2>Visualization <span class="viz-subtitle">${product.productName} · ${elevStr}</span></h2>
    <div class="viz-layout">
      <canvas class="radar-canvas" width="${SIZE}" height="${SIZE}"></canvas>
      <div class="viz-sidebar">
        <div class="viz-info" id="viz-info">${EMPTY_INFO}</div>
        <div id="viz-legend" class="viz-legend"></div>
        <div class="viz-hint">Scroll to zoom · drag to pan</div>
      </div>
    </div>
  `;

  const canvas = card.querySelector<HTMLCanvasElement>('.radar-canvas')!;
  const infoEl = card.querySelector<HTMLElement>('#viz-info')!;
  const legendEl = card.querySelector<HTMLElement>('#viz-legend')!;

  if (!product.radials && !product.rasterData) {
    infoEl.innerHTML = `<div class="viz-info-ph">No visualizable data available for this product.</div>`;
    return card;
  }

  buildLegend(legendEl, product);

  const isRaster = !product.radials && !!product.rasterData;
  // Legacy 16-level products (CR 37/38 and similar) use a discrete index→color mapping so all
  // 14 data levels get distinct colors regardless of their absolute dBZ value.
  // Only applies to raster products — radial products (e.g. 56 SRM) have real physical values
  // from the legacy threshold decoder and must go through buildColorLookup instead.
  const colors = isRaster && product.numDataLevels === 16 ? buildLegacy16ColorLookup() : buildColorLookup(product);

  let azLut: Int16Array | null = null;
  let offscreen: HTMLCanvasElement, scale: number, maxKm: number;

  if (isRaster) {
    ({ offscreen, scale, maxKm } = renderRasterToOffscreen(product.rasterData!, colors));
  } else {
    azLut = buildAzLookup(product.radials!);
    ({ offscreen, scale, maxKm } = renderDataToOffscreen(product, colors, azLut));
  }

  // Pan/zoom state
  let panX = 0, panY = 0, zoom = 1;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0, dragPanX = 0, dragPanY = 0;

  const ctx = canvas.getContext('2d')!;
  const cx = SIZE / 2, cy = SIZE / 2;

  function repaint() {
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Blit offscreen with pan/zoom transform
    ctx.save();
    ctx.translate(cx + panX, cy + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();

    // Overlays in screen space (radar center = cx+panX, cy+panY)
    drawOverlays(ctx, cx + panX, cy + panY, scale * zoom, maxKm);
  }

  repaint();

  // Convert CSS-pixel event coords to data-space dx,dy from radar center
  function toDxDy(e: MouseEvent): { dx: number; dy: number } {
    const rect = canvas.getBoundingClientRect();
    const cs = SIZE / rect.width;
    return {
      dx: ((e.clientX - rect.left) * cs - cx - panX) / zoom,
      dy: ((e.clientY - rect.top)  * cs - cy - panY) / zoom,
    };
  }

  // Hover
  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) return; // drag handled on window

    const { dx, dy } = toDxDy(e);

    if (isRaster) {
      const rd = product.rasterData!;
      const eastKm  =  dx / scale;
      const northKm = -dy / scale;
      const gridCol = Math.round(rd.radarCol + eastKm  / rd.kmPerPixelX);
      const gridRow = Math.round(rd.radarRow - northKm / rd.kmPerPixelY);

      if (gridCol < 0 || gridCol >= rd.cols || gridRow < 0 || gridRow >= rd.rows) {
        infoEl.innerHTML = EMPTY_INFO;
        return;
      }

      const code = rd.grid[gridRow * rd.cols + gridCol];
      const value = product.gateValue(code);
      // Approximate lat/lon from Cartesian km offset (flat-Earth, sufficient for display)
      const R = 111.32;
      const lat = product.radarLatitude  + northKm / R;
      const lon = product.radarLongitude + eastKm  / (R * Math.cos(product.radarLatitude * Math.PI / 180));

      const valueStr = code === 0
        ? '<em>Below threshold</em>'
        : code === 1
        ? '<em>Range folded</em>'
        : value !== null
        ? `<strong>${value.toFixed(1)}</strong> ${product.unit}`
        : 'N/A';

      infoEl.innerHTML = `
        <table class="viz-table">
          <tr><th>Latitude</th><td>${lat.toFixed(4)}°</td></tr>
          <tr><th>Longitude</th><td>${lon.toFixed(4)}°</td></tr>
          <tr><th>East</th><td>${eastKm.toFixed(1)} km</td></tr>
          <tr><th>North</th><td>${northKm.toFixed(1)} km</td></tr>
          <tr><th>Gate Code</th><td>${code}</td></tr>
          <tr class="viz-value-row"><th>Value</th><td>${valueStr}</td></tr>
        </table>
      `;
      return;
    }

    // Radial hover
    const km = Math.sqrt(dx * dx + dy * dy) / scale;

    if (km < product.firstGateRangeKm || km > maxKm) {
      infoEl.innerHTML = EMPTY_INFO;
      return;
    }

    let az = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (az < 0) az += 360;

    const ri = azLut![Math.floor(az * 10) % 3600];
    if (ri === -1) { infoEl.innerHTML = EMPTY_INFO; return; }

    const gi = Math.min(
      product.numberOfGates - 1,
      Math.max(0, Math.floor((km - product.firstGateRangeKm) / product.gateResolutionKm)),
    );

    const code = product.radials![ri].bins[gi];
    const value = product.gateValue(code);
    const radialAz = product.radials![ri].azimuthDeg;
    const gateCenterKm = product.firstGateRangeKm + (gi + 0.5) * product.gateResolutionKm;
    const loc = product.gateLocation(radialAz, gateCenterKm);

    const valueStr = code === 0
      ? '<em>Below threshold</em>'
      : code === 1
      ? '<em>Range folded</em>'
      : value !== null
      ? CC_PRODUCTS.has(product.productCode)
        ? `<strong>${(value * 100).toFixed(1)}</strong> %`
        : `<strong>${value.toFixed(1)}</strong> ${product.unit}`
      : 'N/A';

    infoEl.innerHTML = `
      <table class="viz-table">
        <tr><th>Azimuth</th><td>${az.toFixed(1)}°</td></tr>
        <tr><th>Sl. Range</th><td>${km.toFixed(1)} km</td></tr>
        <tr><th>Gnd Range</th><td>${loc.groundRangeKm.toFixed(1)} km</td></tr>
        <tr><th>Latitude</th><td>${loc.latitude.toFixed(4)}°</td></tr>
        <tr><th>Longitude</th><td>${loc.longitude.toFixed(4)}°</td></tr>
        <tr><th>Altitude</th><td>${loc.altitudeMsl.toFixed(0)} m MSL</td></tr>
        <tr><th>Gate Code</th><td>${code}</td></tr>
        <tr class="viz-value-row"><th>Value</th><td>${valueStr}</td></tr>
      </table>
    `;
  });

  canvas.addEventListener('mouseleave', () => {
    if (!isDragging) infoEl.innerHTML = EMPTY_INFO;
  });

  // Drag
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragPanX = panX;
    dragPanY = panY;
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !document.contains(canvas)) return;
    const rect = canvas.getBoundingClientRect();
    const cs = SIZE / rect.width;
    panX = dragPanX + (e.clientX - dragStartX) * cs;
    panY = dragPanY + (e.clientY - dragStartY) * cs;
    repaint();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging || !document.contains(canvas)) return;
    isDragging = false;
    canvas.style.cursor = 'crosshair';
  });

  // Zoom toward cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const rect = canvas.getBoundingClientRect();
    const cs = SIZE / rect.width;
    const mx = (e.clientX - rect.left) * cs;
    const my = (e.clientY - rect.top)  * cs;

    // Data point under cursor before zoom
    const dataX = (mx - cx - panX) / zoom;
    const dataY = (my - cy - panY) / zoom;

    zoom = Math.max(0.4, Math.min(25, zoom * factor));

    // Adjust pan to keep cursor over same data point
    panX = mx - cx - dataX * zoom;
    panY = my - cy - dataY * zoom;

    repaint();
  }, { passive: false });

  return card;
}
