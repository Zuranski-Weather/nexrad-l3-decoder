/**
 * NEXRAD Level 3 gate spacing lookup.
 *
 * Super-resolution products use 250m (0.25 km) gate spacing.
 * TDWR products use 150m (0.15 km) gate spacing.
 * All other digital radial products use 1000m (1.0 km) spacing.
 */
const SUPER_RES_PRODUCTS = new Set([
  // Super-res reflectivity/width/dual-pol (0.25 km)
  153, 154, 155, 159, 161, 163, 165, 167, 168,
  // Digital velocity array products (Build 14+): 0.25 km gates, 300 km range
  98, 99,
]);

const TDWR_PRODUCTS = new Set([
  180, 181, 182, 183, 185, 186, 187,
]);

export function getGateResolutionKm(productCode: number): number {
  const code = Math.abs(productCode);
  if (SUPER_RES_PRODUCTS.has(code)) return 0.25;
  if (TDWR_PRODUCTS.has(code)) return 0.15;
  return 1.0;
}
