/**
 * Design tokens — single source of truth for colors, spacing, radii, type scale,
 * blur intensities, glass surfaces, shadows and motion presets.
 * Kept framework-free so feature UI composes on top of them.
 *
 * Direction: almost-black background, deep purple surfaces and a lavender
 * accent. The `neutral` ramp is intentionally inverted (0 = background,
 * 900 = primary text) so older screens that predate the glass layer still
 * render on-theme instead of flipping back to a light UI.
 */

export const palette = {
    /** App background — almost black with a violet undertone. */
    background: '#09070F',
    /** Default card / sheet surface. */
    surface: '#120D1C',
    /** Raised purple surface (menus, selected cards). */
    elevated: '#21152F',
    primary: {
        100: '#2A1B3D', // subtle purple wash
        300: '#A970F5', // bright lavender
        500: '#7545B8', // brand purple
        600: '#B98BF0', // purple used for text / links on dark
        700: '#DCC5FF', // soft lavender highlight
    },
    accent: '#A970F5',
    highlight: '#DCC5FF',
    neutral: {
        0: '#09070F',
        50: '#120D1C',
        100: '#241733',
        300: '#4A3A5E',
        500: '#9A8AAE',
        700: '#CDBFDD',
        900: '#F4EFFA',
    },
    text: {
        primary: '#F4EFFA',
        secondary: '#B3A3C7',
        muted: '#8E7FA3',
        /** Text/icons placed on a purple accent surface. */
        onAccent: '#FFFFFF',
        inverse: '#09070F',
    },
    border: {
        subtle: 'rgba(220,197,255,0.12)',
        strong: 'rgba(220,197,255,0.24)',
        accent: 'rgba(169,112,245,0.55)',
    },
    /** Translucent fills layered over a BlurView. */
    glass: {
        surface: 'rgba(18,13,28,0.58)',
        elevated: 'rgba(33,21,47,0.66)',
        header: 'rgba(9,7,15,0.62)',
        accent: 'rgba(117,69,184,0.22)',
        highlight: 'rgba(220,197,255,0.08)',
    },
    semantic: {
        success: '#6FD79B',
        warning: '#F5C56B',
        danger: '#FF7A8A',
        info: '#9BC7FF',
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
    xl: 28,
    full: 999,
} as const;

export const typography = {
    display: {
        fontSize: 30,
        fontWeight: '700' as const,
        letterSpacing: -0.6,
        color: palette.text.primary,
    },
    title: {
        fontSize: 22,
        fontWeight: '700' as const,
        letterSpacing: -0.3,
        color: palette.text.primary,
    },
    heading: {
        fontSize: 18,
        fontWeight: '700' as const,
        letterSpacing: -0.2,
        color: palette.text.primary,
    },
    body: {
        fontSize: 15,
        fontWeight: '400' as const,
        lineHeight: 21,
        color: palette.text.primary,
    },
    label: {
        fontSize: 13,
        fontWeight: '600' as const,
        color: palette.text.primary,
    },
    caption: {
        fontSize: 12,
        fontWeight: '500' as const,
        color: palette.text.secondary,
    },
} as const;

/** BlurView intensity presets (0–100). */
export const blur = {
    subtle: 22,
    regular: 40,
    strong: 62,
    overlay: 50,
} as const;

/** Shared purple-tinted elevation. */
export const shadows = {
    glass: {
        shadowColor: '#4B1E82',
        shadowOpacity: 0.38,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    floating: {
        shadowColor: '#7545B8',
        shadowOpacity: 0.45,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
    },
} as const;

export const motion = {
    spring: { damping: 18, stiffness: 220, mass: 0.7 },
    springSoft: { damping: 22, stiffness: 160, mass: 0.9 },
    duration: { fast: 140, normal: 220, screen: 260, sheet: 300 },
    /** Subtle scale used for press feedback. */
    pressScale: 0.97,
} as const;

export const theme = {
    palette,
    spacing,
    radii,
    typography,
    blur,
    shadows,
    motion,
} as const;

export type Theme = typeof theme;
