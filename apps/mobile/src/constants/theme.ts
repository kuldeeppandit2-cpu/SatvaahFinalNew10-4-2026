/**
 * apps/mobile/src/constants/theme.ts
 * Design tokens re-exported for screens that import from this path.
 * Canonical colour source: apps/mobile/src/constants/colors.ts
 */
import { COLORS as BASE_COLORS } from './colors';

export const COLORS = {
  ...BASE_COLORS,
  // Aliases used by provider screens
  primary:    BASE_COLORS.saffron,
  secondary:  BASE_COLORS.verdigris,
  background: BASE_COLORS.ivory,
  surface:    BASE_COLORS.white,
  onPrimary:  BASE_COLORS.textOnSaffron,
  error:      BASE_COLORS.terracotta,
};

export const FONTS = {
  regular:    'PlusJakartaSans-Regular',
  medium:     'PlusJakartaSans-Medium',
  semiBold:   'PlusJakartaSans-SemiBold',
  bold:       'PlusJakartaSans-Bold',
  extraBold:  'PlusJakartaSans-ExtraBold',
} as const;

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const RADIUS = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  full: 9999,
} as const;
