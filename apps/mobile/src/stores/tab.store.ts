/**
 * Stores the last active HomeScreen tab so SearchScreen
 * can use it as the default suggest tab when opened from
 * the bottom tab navigator (no route params).
 */
import { create } from 'zustand';
import type { Tab } from '../api/search.api';

interface TabState {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

export const useTabStore = create<TabState>((set) => ({
  activeTab: 'services',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
