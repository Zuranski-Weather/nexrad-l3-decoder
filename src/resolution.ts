/**
 * NEXRAD Level 3 gate/pixel spacing lookup.
 *
 * For radial products this is the physical gate bin size in km.
 * For raster products this is the physical pixel cell size in km
 * (the raster packet xScaleInt field is a PUP display zoom factor — not km — and is ignored).
 *
 * Super-resolution products use 250m (0.25 km) gate spacing.
 * TDWR short-range products use 150m (0.15 km) gate spacing.
 * TDWR long-range products (181, 183, 186) use 300m (0.30 km) gate spacing.
 * Composite Reflectivity Extended (38) raster uses 4.0 km/pixel (248 Nmi radius).
 * Some accumulation products (e.g. OHA/169) use 2000m (2.0 km) gate spacing.
 * Composite Reflectivity Short Range (37) raster uses 1.0 km/pixel (124 Nmi radius, ~460×460 grid).
 * All other products use 1000m (1.0 km) spacing.
 */
const SUPER_RES_PRODUCTS = new Set([
  // Super-res reflectivity/width/dual-pol (0.25 km)
  153, 154, 155, 159, 161, 163, 165, 167, 168,
  // Hydrometeor classification (0.25 km)
  177,
  // Digital velocity array products (Build 14+): 0.25 km gates, 300 km range
  98, 99,
]);

// TDWR short-range products: 0.15 km gate spacing
const TDWR_PRODUCTS = new Set([
  180, 182, 185, 187,
]);

// TDWR long-range products: 0.30 km gate spacing
// 181 = Long-Range Reflectivity, 183 = Long-Range Velocity, 186 = TZL (Long-Range Refl Super Res)
const TDWR_LONG_RANGE_PRODUCTS = new Set([
  181, 183, 186,
]);

// 2 km pixel/gate spacing products
// 169 = One-Hour Accumulation (OHA): 115 bins × 2.0 km = 230 km range
const TWO_KM_PRODUCTS = new Set([
  169,
]);

// 4 km pixel spacing raster products
// 38 = Composite Reflectivity Extended Range (248 Nmi): 232 cells × ~4 km = ~460 km radius
// NOTE: the raster packet xScaleInt field is a PUP display zoom factor (screen px per cell),
// NOT a physical km/cell value — all raster resolutions come from this table.
const FOUR_KM_PRODUCTS = new Set([
  38,
]);

export function getGateResolutionKm(productCode: number): number {
  const code = Math.abs(productCode);
  if (SUPER_RES_PRODUCTS.has(code)) return 0.25;
  if (FOUR_KM_PRODUCTS.has(code)) return 4.0;
  if (TWO_KM_PRODUCTS.has(code)) return 2.0;
  if (TDWR_PRODUCTS.has(code)) return 0.15;
  if (TDWR_LONG_RANGE_PRODUCTS.has(code)) return 0.30;
  return 1.0;
}
