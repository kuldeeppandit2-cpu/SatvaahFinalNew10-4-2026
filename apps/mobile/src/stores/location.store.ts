/**
 * apps/mobile/src/stores/location.store.ts
 *
 * Consumer GPS location — persisted across restarts.
 *
 * FIX-02 (BUG-04): location was in-memory only. On cold start the store
 * defaulted to Hyderabad (17.385, 78.4867) even if the user is in Mumbai.
 * Search fired with wrong coords until GPS refresh arrived (~2-4s later).
 *
 * Fix: persist lat/lng to MMKV (AsyncStorage-backed in Expo Go).
 * Cold start reads the last known location immediately → correct city results
 * on first render. App.tsx GPS capture overwrites with fresh coords when ready.
 *
 * MMKV keys: 'location.lat', 'location.lng' — in 'satvaaah-location' store.
 */

import { create } from 'zustand';
import { MMKV } from '../__stubs__/mmkv';

const storage = new MMKV({ id: 'satvaaah-location' });

const LAT_KEY = 'location.lat';
const LNG_KEY = 'location.lng';

// Hyderabad city centre — default when no GPS history exists
const DEFAULT_LAT = 17.385;
const DEFAULT_LNG = 78.4867;

// Read persisted coords synchronously on module init.
// After preloadAllMmkvStores() (called in App.tsx before any store reads),
// this returns the last known location from the previous session.
function persistedLat(): number {
  const raw = storage.getString(LAT_KEY);
  if (!raw) return DEFAULT_LAT;
  const n = parseFloat(raw);
  return isNaN(n) || n < -90 || n > 90 ? DEFAULT_LAT : n;
}

function persistedLng(): number {
  const raw = storage.getString(LNG_KEY);
  if (!raw) return DEFAULT_LNG;
  const n = parseFloat(raw);
  return isNaN(n) || n < -180 || n > 180 ? DEFAULT_LNG : n;
}

interface LocationState {
  lat: number;
  lng: number;
  setLocation: (loc: { lat: number; lng: number }) => void;
  /** Async preload — call from preloadAllMmkvStores in App.tsx */
  preload: () => Promise<void>;
}

export const useLocationStore = create<LocationState>((set) => ({
  lat: DEFAULT_LAT,  // replaced after preload()
  lng: DEFAULT_LNG,
  setLocation: (loc: { lat: number; lng: number }): void => {
    // Validate before storing — never persist 0,0 or out-of-bounds
    const lat = isNaN(loc.lat) || loc.lat < -90  || loc.lat > 90  ? DEFAULT_LAT : loc.lat;
    const lng = isNaN(loc.lng) || loc.lng < -180 || loc.lng > 180 ? DEFAULT_LNG : loc.lng;
    storage.set(LAT_KEY, String(lat));
    storage.set(LNG_KEY, String(lng));
    set({ lat, lng });
  },
  preload: async (): Promise<void> => {
    await storage.preload();
    set({ lat: persistedLat(), lng: persistedLng() });
  },
}));
