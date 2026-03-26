import type { GateLocation } from './api-types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const RE = 6371.0;     // Mean earth radius in km
const KE = 4 / 3;      // Effective earth radius factor for standard refraction
const KE_RE = KE * RE;  // ~8494.67 km

/**
 * Create a closure that computes gate locations for a fixed radar site and
 * elevation angle. Precomputes trig for the radar position and elevation
 * so that per-gate calls are fast.
 *
 * Beam propagation (4/3 effective earth radius model):
 *   h = sqrt(r² + (ke·Re)² + 2·r·ke·Re·sin(elev)) - ke·Re
 *   s = ke·Re · arcsin(r·cos(elev) / (ke·Re + h))
 *
 * Lat/lon from great-circle forward (spherical earth):
 *   lat2 = asin(sin(lat1)·cos(d/Re) + cos(lat1)·sin(d/Re)·cos(az))
 *   lon2 = lon1 + atan2(sin(az)·sin(d/Re)·cos(lat1), cos(d/Re) - sin(lat1)·sin(lat2))
 */
export function createGateLocator(
  radarLatDeg: number,
  radarLonDeg: number,
  radarHeightM: number,
  elevationDeg: number,
): (azimuthDeg: number, slantRangeKm: number) => GateLocation {
  const radarLatRad = radarLatDeg * DEG_TO_RAD;
  const radarLonRad = radarLonDeg * DEG_TO_RAD;
  const sinRadarLat = Math.sin(radarLatRad);
  const cosRadarLat = Math.cos(radarLatRad);
  const elevRad = elevationDeg * DEG_TO_RAD;
  const sinElev = Math.sin(elevRad);
  const cosElev = Math.cos(elevRad);
  const radarHeightKm = radarHeightM / 1000;

  return (azimuthDeg: number, slantRangeKm: number): GateLocation => {
    const r = slantRangeKm;

    // Height above radar level
    const heightAboveRadarKm =
      Math.sqrt(r * r + KE_RE * KE_RE + 2 * r * KE_RE * sinElev) - KE_RE;

    // Altitude above MSL in meters
    const altitudeMsl = (heightAboveRadarKm + radarHeightKm) * 1000;

    // Great-circle ground range
    const groundRangeKm =
      KE_RE * Math.asin((r * cosElev) / (KE_RE + heightAboveRadarKm));

    // Great-circle forward: ground range + azimuth → lat/lon
    const azRad = azimuthDeg * DEG_TO_RAD;
    const angularDist = groundRangeKm / RE;
    const sinDist = Math.sin(angularDist);
    const cosDist = Math.cos(angularDist);

    const sinLat2 = sinRadarLat * cosDist + cosRadarLat * sinDist * Math.cos(azRad);
    const lat2 = Math.asin(sinLat2);
    const lon2 =
      radarLonRad +
      Math.atan2(
        Math.sin(azRad) * sinDist * cosRadarLat,
        cosDist - sinRadarLat * sinLat2,
      );

    return {
      latitude: lat2 * RAD_TO_DEG,
      longitude: lon2 * RAD_TO_DEG,
      altitudeMsl,
      groundRangeKm,
    };
  };
}
