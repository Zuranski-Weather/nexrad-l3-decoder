/**
 * NEXRAD Level 3 gate spacing lookup.
 *
 * Super-resolution products use 250m (0.25 km) gate spacing.
 * TDWR short-range products use 150m (0.15 km) gate spacing.
 * TDWR long-range products (181, 183, 186) use 300m (0.30 km) gate spacing.
 * All other digital radial products use 1000m (1.0 km) spacing.
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

// Half-km products: 0.50 km gate spacing
const HALF_KM_PRODUCTS = new Set([
  134, // Digital VIL (DVL): 460 bins × 0.5 km = 230 km range
]);

export function getGateResolutionKm(productCode: number): number {
  const code = Math.abs(productCode);
  if (SUPER_RES_PRODUCTS.has(code)) return 0.25;
  if (HALF_KM_PRODUCTS.has(code)) return 0.50;
  if (TDWR_PRODUCTS.has(code)) return 0.15;
  if (TDWR_LONG_RANGE_PRODUCTS.has(code)) return 0.30;
  return 1.0;
}
