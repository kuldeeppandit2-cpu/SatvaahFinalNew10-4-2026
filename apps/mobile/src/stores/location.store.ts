import { create } from 'zustand';

interface LocationState {
  lat: number;
  lng: number;
  setLocation: (loc: { lat: number; lng: number }) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  lat: 17.385,   // Default: Hyderabad centre
  lng: 78.4867,
  setLocation: (loc) => set(loc),
}));
