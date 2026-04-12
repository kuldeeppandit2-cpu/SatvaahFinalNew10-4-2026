/**
 * apps/mobile/src/hooks/useLocation.ts
 *
 * Returns consumer GPS coordinates from useLocationStore.
 * GPS is captured ONCE at login (ModeSelectionScreen.captureGpsSilently).
 * All search screens read from the store — no per-screen GPS requests.
 *
 * Store is populated by:
 *   ModeSelectionScreen → expo-location → useLocationStore.setLocation()
 *
 * Fallback: Hyderabad city centre (17.385, 78.4867) — store default,
 * used when GPS was denied or unavailable at login.
 */

import { useLocationStore } from '../stores/location.store';

export interface Coords {
  lat: number;
  lng: number;
}

export function useLocation(): Coords {
  const { lat, lng } = useLocationStore();
  return { lat, lng };
}
