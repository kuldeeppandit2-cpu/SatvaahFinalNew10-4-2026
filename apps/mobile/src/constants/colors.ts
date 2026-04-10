/**
 * SatvAAh Brand Colours
 * Single source of truth — every screen imports from here
 */

export const COLORS = {
  // Primary palette
  saffron: '#C8691A',        // Primary CTA, active states, Consumer accent
  deepInk: '#1C1C2E',        // All body text
  ivory: '#FAF7F0',          // All screen backgrounds
  verdigris: '#2E7D72',      // Highly Trusted tier, Provider accent
  lightVerdigris: '#6BA89E', // Trusted tier ring
  warmSand: '#F0E4CC',       // Search bar background

  // Trust tier ring colours
  tierUnverified: '#6B6560', // 0–19
  tierBasic: '#C8691A',      // 20–39  (saffron)
  tierTrusted: '#6BA89E',    // 60–79  (light verdigris)
  tierHighlyTrusted: '#2E7D72', // 80–100 (verdigris)

  // Status / feedback
  terracotta: '#C0392B',     // Error, warning, loss aversion states
  success: '#2E7D72',        // Same as verdigris
  muted: '#9E9589',          // Secondary text, inactive states
  mutedLight: '#C8C0B4',     // Placeholder text, borders

  // Backgrounds
  white: '#FFFFFF',
  cardBackground: '#FFFFFF',
  screenBackground: '#FAF7F0', // ivory

  // Borders
  border: '#E8E0D5',
  borderFocused: '#C8691A', // saffron

  // Text
  textPrimary: '#1C1C2E',   // deepInk
  textSecondary: '#6B6560',
  textMuted: '#9E9589',
  textOnSaffron: '#FAF7F0', // ivory on saffron CTA
  textOnVerdigris: '#FAF7F0',
} as const;

export type ColorKey = keyof typeof COLORS;
