/**
 * Design tokens — single source of truth for colors, spacing, radii and type scale.
 * Kept framework-free so feature UI composes on top of them.
 */

export const palette = {
  primary: {
    100: '#E6F4FE',
    300: '#7CC6F2',
    500: '#2196F3',
    600: '#1A80D2',
    700: '#1565C0',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#F7F9FA',
    100: '#EEF1F4',
    300: '#C6CDD5',
    500: '#7B8794',
    700: '#454F5B',
    900: '#1C2024',
  },
  semantic: {
    success: '#2E7D32',
    warning: '#F9A825',
    danger: '#C62828',
    info: '#2196F3',
  },
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 999,
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '700' as const, color: palette.neutral[900] },
  body: { fontSize: 15, fontWeight: '400' as const, color: palette.neutral[900] },
  caption: { fontSize: 12, fontWeight: '500' as const, color: palette.neutral[500] },
} as const;

export const theme = { palette, spacing, radii, typography } as const;

export type Theme = typeof theme;
