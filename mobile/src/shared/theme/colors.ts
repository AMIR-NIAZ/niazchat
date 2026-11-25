/**
 * Theme color tokens.
 *
 * Pure functions only: this module must stay free of store/react imports so the
 * feature layer can depend on it (no cycles). `buildThemeColors` turns a mode,
 * an accent and two optional bubble overrides into the complete token set the
 * app renders with. Any text placed on a colored surface is chosen by WCAG
 * relative luminance, never hardcoded.
 */

export type ResolvedThemeMode = 'light' | 'dark';

export const ACCENT_PRESETS = [
    { id: 'lavender', label: 'Lavender', value: '#A970F5' },
    { id: 'blue', label: 'Blue', value: '#2F80ED' },
    { id: 'teal', label: 'Teal', value: '#0E9F8E' },
    { id: 'green', label: 'Green', value: '#2E9E5B' },
    { id: 'amber', label: 'Amber', value: '#C97A10' },
    { id: 'rose', label: 'Rose', value: '#D94F86' },
    { id: 'red', label: 'Red', value: '#D64545' },
    { id: 'indigo', label: 'Indigo', value: '#6C5CE7' },
] as const;

export type AccentId = (typeof ACCENT_PRESETS)[number]['id'];

export function accentValue(id: AccentId): string {
    return ACCENT_PRESETS.find((preset) => preset.id === id)?.value ?? '#A970F5';
}

/** Solid chat background presets (work in both themes). */
export const SOLID_BACKGROUND_PRESETS = [
    { id: 'midnight', label: 'Midnight', value: '#0F1720' },
    { id: 'forest', label: 'Forest', value: '#17261F' },
    { id: 'plum', label: 'Plum', value: '#2A1B36' },
    { id: 'sand', label: 'Sand', value: '#E9DFC9' },
    { id: 'mist', label: 'Mist', value: '#E7EDF6' },
] as const;

/** Two-stop gradient chat backgrounds. */
export const GRADIENT_PRESETS = [
    { id: 'dusk', label: 'Dusk', colors: ['#1B1030', '#0B0913'] as const },
    { id: 'ocean', label: 'Ocean', colors: ['#0D2B3E', '#0B1220'] as const },
    { id: 'forest', label: 'Forest', colors: ['#123027', '#0B1410'] as const },
    { id: 'sunrise', label: 'Sunrise', colors: ['#3A1B2E', '#12101F'] as const },
] as const;

export type GradientId = (typeof GRADIENT_PRESETS)[number]['id'];
export type SolidBackgroundId = (typeof SOLID_BACKGROUND_PRESETS)[number]['id'];

/** Own / other bubble color presets. `null` means "derive from theme". */
export const BUBBLE_COLOR_PRESETS = [
    { id: 'auto', label: 'Auto', value: null },
    { id: 'lavender', label: 'Lavender', value: '#A970F5' },
    { id: 'blue', label: 'Blue', value: '#2A6FD6' },
    { id: 'green', label: 'Green', value: '#2E7D5B' },
    { id: 'slate', label: 'Slate', value: '#3B4252' },
    { id: 'sand', label: 'Sand', value: '#E4D7C0' },
    { id: 'cloud', label: 'Cloud', value: '#FFFFFF' },
] as const;

export interface ThemeColors {
    mode: ResolvedThemeMode;
    background: string;
    backgroundAlt: string;
    surface: string;
    surfaceElevated: string;
    header: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    borderStrong: string;
    accent: string;
    accentSoft: string;
    accentBorder: string;
    accentText: string;
    glassSurface: string;
    glassElevated: string;
    glassHeader: string;
    glassAccent: string;
    bubbleOwn: string;
    bubbleOwnText: string;
    bubbleOwnMuted: string;
    bubbleOther: string;
    bubbleOtherText: string;
    bubbleOtherMuted: string;
    bubbleBorder: string;
    quoteOwn: string;
    quoteOther: string;
    link: string;
    linkOnOwn: string;
    mention: string;
    mentionOnOwn: string;
    danger: string;
    dangerSoft: string;
    success: string;
    warning: string;
    info: string;
    badge: string;
    badgeText: string;
    switchTrack: string;
    switchTrackOn: string;
    separatorPill: string;
    separatorPillBorder: string;
    separatorPillText: string;
    chatScrim: string;
    patternTint: string;
}

const DARK_BASE = {
    background: '#09070F',
    backgroundAlt: '#120D1C',
    surface: '#120D1C',
    surfaceElevated: '#21152F',
    text: '#F4EFFA',
    textSecondary: '#B3A3C7',
    textMuted: '#8E7FA3',
    border: 'rgba(220,197,255,0.12)',
    borderStrong: 'rgba(220,197,255,0.24)',
    glassSurface: 'rgba(18,13,28,0.58)',
    glassElevated: 'rgba(33,21,47,0.66)',
    glassHeader: 'rgba(9,7,15,0.62)',
    link: '#1E90FF',
    danger: '#FF7A8A',
    success: '#6FD79B',
    warning: '#F5C56B',
    info: '#9BC7FF',
} as const;

const LIGHT_BASE = {
    background: '#F5F2FA',
    backgroundAlt: '#EDE8F6',
    surface: '#FFFFFF',
    surfaceElevated: '#F1ECFA',
    text: '#17121F',
    textSecondary: '#5D5470',
    textMuted: '#7C7489',
    border: 'rgba(23,18,31,0.12)',
    borderStrong: 'rgba(23,18,31,0.22)',
    glassSurface: 'rgba(255,255,255,0.72)',
    glassElevated: 'rgba(255,255,255,0.88)',
    glassHeader: 'rgba(250,247,255,0.82)',
    link: '#0B63CE',
    danger: '#C22D3F',
    success: '#1B7F4B',
    warning: '#8A5A00',
    info: '#1D5FA8',
} as const;

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` → `[r, g, b, a]` (0–255, a 0–1). */
function parseColor(input: string): [number, number, number, number] | null {
    const value = input.trim();
    const hex = value.startsWith('#') ? value.slice(1) : null;
    if (hex === null) {
        return null;
    }
    const expand = (part: string): number => parseInt(part, 16);
    if (hex.length === 3) {
        const short = hex.padEnd(3, '0');
        return [
            expand(short.charAt(0) + short.charAt(0)),
            expand(short.charAt(1) + short.charAt(1)),
            expand(short.charAt(2) + short.charAt(2)),
            1,
        ];
    }
    if (hex.length === 6 || hex.length === 8) {
        return [
            expand(hex.slice(0, 2)),
            expand(hex.slice(2, 4)),
            expand(hex.slice(4, 6)),
            hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1,
        ];
    }
    return null;
}

export function withAlpha(color: string, alpha: number): string {
    const parsed = parseColor(color);
    if (parsed === null) {
        return color;
    }
    const clamped = Math.min(1, Math.max(0, alpha));
    return `rgba(${parsed[0] ?? 0},${parsed[1] ?? 0},${parsed[2] ?? 0},${clamped})`;
}

export function mixColors(a: string, b: string, amount: number): string {
    const first = parseColor(a);
    const second = parseColor(b);
    if (first === null || second === null) {
        return a;
    }
    const t = Math.min(1, Math.max(0, amount));
    const channel = (index: number): number =>
        Math.round(
            (first[index] ?? 0) * (1 - t) + (second[index] ?? 0) * t,
        );
    return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

function channelLuminance(channel: number): number {
    const value = channel / 255;
    return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: string): number {
    const parsed = parseColor(color);
    if (parsed === null) {
        return 0;
    }
    return (
        0.2126 * channelLuminance(parsed[0] ?? 0) +
        0.7152 * channelLuminance(parsed[1] ?? 0) +
        0.0722 * channelLuminance(parsed[2] ?? 0)
    );
}

export function contrastRatio(a: string, b: string): number {
    const first = relativeLuminance(a);
    const second = relativeLuminance(b);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT_TEXT = '#FFFFFF';
const DARK_TEXT = '#0B0A0F';

/**
 * The most readable of white / near-black on `background`. WCAG contrast
 * decides; ties go to white (matches the app's existing accent treatment).
 */
export function readableTextColor(background: string): string {
    return contrastRatio(background, LIGHT_TEXT) >=
        contrastRatio(background, DARK_TEXT)
        ? LIGHT_TEXT
        : DARK_TEXT;
}

/** First candidate that reaches `minimum` against `background`, else the best. */
export function firstReadableColor(
    background: string,
    candidates: readonly string[],
    minimum = 4.5,
): string {
    let best = candidates[0] ?? readableTextColor(background);
    let bestRatio = 0;
    for (const candidate of candidates) {
        const ratio = contrastRatio(background, candidate);
        if (ratio >= minimum) {
            return candidate;
        }
        if (ratio > bestRatio) {
            best = candidate;
            bestRatio = ratio;
        }
    }
    return best;
}

/**
 * Complete token set for one appearance configuration. Pure: the same inputs
 * always produce the same strings, which keeps `useThemedStyles` caches warm.
 */
export function buildThemeColors(
    mode: ResolvedThemeMode,
    accent: string,
    bubbleOwnOverride: string | null,
    bubbleOtherOverride: string | null,
): ThemeColors {
    const dark = mode === 'dark';
    const base = dark ? DARK_BASE : LIGHT_BASE;

    const bubbleOwn = bubbleOwnOverride ?? accent;
    const bubbleOther =
        bubbleOtherOverride ?? (dark ? base.surfaceElevated : '#FFFFFF');
    const bubbleOwnText = readableTextColor(bubbleOwn);
    const bubbleOtherText = readableTextColor(bubbleOther);

    // The classic link blue is preserved in dark mode; on an arbitrary bubble
    // color the most readable of the app's blue shades wins.
    const linkCandidates = dark
        ? (['#1E90FF', '#CFE3FF', '#7FC4FF', '#0B3B66'] as const)
        : (['#0B63CE', '#1E90FF', '#CFE3FF', '#083B66'] as const);

    return {
        mode,
        background: base.background,
        backgroundAlt: base.backgroundAlt,
        surface: base.surface,
        surfaceElevated: base.surfaceElevated,
        header: base.glassHeader,
        text: base.text,
        textSecondary: base.textSecondary,
        textMuted: base.textMuted,
        border: base.border,
        borderStrong: base.borderStrong,
        accent,
        accentSoft: withAlpha(accent, dark ? 0.22 : 0.14),
        accentBorder: withAlpha(accent, 0.55),
        accentText: readableTextColor(accent),
        glassSurface: base.glassSurface,
        glassElevated: base.glassElevated,
        glassHeader: base.glassHeader,
        glassAccent: withAlpha(accent, dark ? 0.2 : 0.12),
        bubbleOwn,
        bubbleOwnText,
        bubbleOwnMuted: withAlpha(bubbleOwnText, 0.74),
        bubbleOther,
        bubbleOtherText,
        bubbleOtherMuted: withAlpha(bubbleOtherText, 0.62),
        bubbleBorder: dark ? base.border : 'rgba(23,18,31,0.08)',
        quoteOwn: withAlpha(bubbleOwnText, 0.16),
        quoteOther: withAlpha(bubbleOtherText, 0.07),
        link: base.link,
        linkOnOwn: firstReadableColor(bubbleOwn, linkCandidates),
        mention: base.link,
        mentionOnOwn: firstReadableColor(bubbleOwn, linkCandidates),
        danger: base.danger,
        dangerSoft: withAlpha(base.danger, 0.16),
        success: base.success,
        warning: base.warning,
        info: base.info,
        badge: accent,
        badgeText: readableTextColor(accent),
        switchTrack: withAlpha(accent, 0.35),
        switchTrackOn: accent,
        separatorPill: dark ? 'rgba(9,7,15,0.55)' : 'rgba(255,255,255,0.82)',
        separatorPillBorder: base.border,
        separatorPillText: base.textSecondary,
        chatScrim: dark ? 'rgba(9,7,15,0.18)' : 'rgba(255,255,255,0.24)',
        patternTint: withAlpha(accent, dark ? 0.22 : 0.18),
    };
}
