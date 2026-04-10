/**
 * apps/mobile/src/hooks/useLocation.ts
 * Phase 19 — Replace hardcoded lat:17.385/lng:78.4867 with real GPS
 *
 * Returns user's current GPS coordinates.
 * Falls back to Hyderabad city centre if:
 *   - User denies permission
 *   - GPS unavailable
 *   - Error occurs
 *
 * expo-location ~17.0.1 already in package.json
 */

import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

// Hyderabad city centre — fallback when GPS unavailable / denied
const DEFAULT_LAT = 17.385;
const DEFAULT_LNG = 78.4867;

export interface Coords {
  lat: number;
  lng: number;
}

export function useLocation(): Coords {
  const [coords, setCoords] = useState<Coords>({ lat: DEFAULT_LAT, lng: DEFAULT_LNG });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return; // keep Hyderabad fallback

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (active) {
          setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch {
        // GPS error — Hyderabad fallback already set in useState
      }
    })();
    return () => { active = false; };
  }, []);

  return coords;
}
