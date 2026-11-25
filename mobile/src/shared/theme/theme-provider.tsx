import {
    createContext,
    useContext,
    useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import type { TextStyle } from 'react-native';
import {
    buildThemeColors,
    accentValue,
} from './colors';
import type { ThemeColors } from './colors';
import {
    fontOption,
    fontFamilyFor,
    fontWeightFor,
} from './fonts';
import type { FontId, FontWeightKey } from './fonts';
import {
    BUBBLE_RADII,
    DEFAULT_APPEARANCE,
} from '../../features/settings/appearance-types';
import type { BubbleRadiusId } from '../../features/settings/appearance-types';
import { useAppearanceStore } from '../../features/settings/appearance-store';
import { MAX_FONT_SCALE } from './design-token';

/**
 * Central theme provider.
 *
 * `useTheme()` exposes the resolved color tokens, the scaled typography set,
 * the bubble radius and the selected font. Everything that renders color goes
 * through these tokens so a single settings change repaints the app without
 * remounting screens.
 *
 * `useThemedStyles(factory)` caches one StyleSheet per (theme, factory) pair in
 * a WeakMap: rows and bubbles share the same sheet instance and never rebuild
 * styles per item.
 */

export type TypeVariant =
    | 'display'
    | 'title'
    | 'heading'
    | 'body'
    | 'label'
    | 'caption'
    | 'micro';

/** `maxFontSizeMultiplier` is a Text prop but valid in a style object too. */
export type ThemedTextStyle = TextStyle & {
    maxFontSizeMultiplier?: number;
};

export type ThemeTypeSet = Record<TypeVariant, ThemedTextStyle> & {
    /** Message body text: scaled by the user's text size. */
    message: ThemedTextStyle;
    /** Small meta line under a bubble. */
    messageMeta: ThemedTextStyle;
    /** Chat-list row title: modestly scaled so 130% never overflows. */
    chatTitle: ThemedTextStyle;
    /** Chat-list row preview. */
    chatPreview: ThemedTextStyle;
};

export interface AppTheme {
    mode: 'light' | 'dark';
    isDark: boolean;
    colors: ThemeColors;
    accent: string;
    fontId: FontId;
    fontLabel: string;
    textScale: number;
    radius: { bubble: number };
    type: ThemeTypeSet;
}

interface TypeSpec {
    size: number;
    weight: FontWeightKey;
    /** Line-height multiplier of the font size. */
    lineHeight: number;
    scale?: boolean;
    color?: 'text' | 'textSecondary';
}

const TYPE_SPECS: Record<keyof ThemeTypeSet, TypeSpec> = {
    display: { size: 30, weight: 'bold', lineHeight: 1.27 },
    title: { size: 22, weight: 'bold', lineHeight: 1.27 },
    heading: { size: 18, weight: 'bold', lineHeight: 1.33 },
    body: { size: 15, weight: 'regular', lineHeight: 1.4 },
    label: { size: 13, weight: 'medium', lineHeight: 1.38 },
    caption: { size: 12, weight: 'medium', lineHeight: 1.33, color: 'textSecondary' },
    micro: { size: 10, weight: 'bold', lineHeight: 1.4 },
    message: { size: 15, weight: 'regular', lineHeight: 1.4, scale: true },
    messageMeta: { size: 10, weight: 'regular', lineHeight: 1.4 },
    chatTitle: { size: 18, weight: 'bold', lineHeight: 1.33, scale: true },
    chatPreview: { size: 12, weight: 'regular', lineHeight: 1.33, scale: true },
};

function buildType(
    colors: ThemeColors,
    fontId: FontId,
    textScale: number,
): ThemeTypeSet {
    const option = fontOption(fontId);
    const custom = option.families !== null;
    const family = (weight: FontWeightKey): string | undefined =>
        fontFamilyFor(fontId, weight);
    const lineHeightFactor = option.lineHeightFactor;
    // Custom Persian faces need a looser line box; Android also needs
    // `includeFontPadding: false` or the baseline shifts and glyph tails clip.
    const extra: TextStyle =
        custom && Platform.OS === 'android'
            ? { includeFontPadding: false }
            : {};

    const make = (spec: TypeSpec): ThemedTextStyle => {
        const scale = spec.scale === true ? textScale : 1;
        const size = Math.round(spec.size * scale * 10) / 10;
        const resolvedFamily = family(spec.weight);
        return {
            fontSize: size,
            lineHeight: Math.round(size * spec.lineHeight * lineHeightFactor * 10) / 10,
            ...(resolvedFamily === undefined
                ? { fontWeight: fontWeightFor(fontId, spec.weight) }
                : {
                      fontFamily: resolvedFamily,
                      fontWeight: 'normal' as const,
                  }),
            color:
                spec.color === 'textSecondary'
                    ? colors.textSecondary
                    : colors.text,
            maxFontSizeMultiplier: MAX_FONT_SCALE,
            ...extra,
        };
    };

    return {
        display: make(TYPE_SPECS.display),
        title: make(TYPE_SPECS.title),
        heading: make(TYPE_SPECS.heading),
        body: make(TYPE_SPECS.body),
        label: make(TYPE_SPECS.label),
        caption: make(TYPE_SPECS.caption),
        micro: make(TYPE_SPECS.micro),
        message: make(TYPE_SPECS.message),
        messageMeta: make(TYPE_SPECS.messageMeta),
        chatTitle: make(TYPE_SPECS.chatTitle),
        chatPreview: make(TYPE_SPECS.chatPreview),
    };
}

function buildTheme(
    mode: 'light' | 'dark',
    accentId: (typeof DEFAULT_APPEARANCE)['accentColor'],
    bubbleOwnColor: string | null,
    bubbleOtherColor: string | null,
    bubbleRadius: BubbleRadiusId,
    textScale: number,
    fontId: FontId,
): AppTheme {
    const accent = accentValue(accentId);
    const colors = buildThemeColors(
        mode,
        accent,
        bubbleOwnColor,
        bubbleOtherColor,
    );
    return {
        mode,
        isDark: mode === 'dark',
        colors,
        accent,
        fontId,
        fontLabel: fontOption(fontId).label,
        textScale,
        radius: { bubble: BUBBLE_RADII[bubbleRadius] },
        type: buildType(colors, fontId, textScale),
    };
}

/** Default theme for module-level previews and hook-less tests. */
export const defaultTheme: AppTheme = buildTheme(
    'dark',
    DEFAULT_APPEARANCE.accentColor,
    DEFAULT_APPEARANCE.bubbleOwnColor,
    DEFAULT_APPEARANCE.bubbleOtherColor,
    DEFAULT_APPEARANCE.bubbleRadius,
    DEFAULT_APPEARANCE.textScale,
    DEFAULT_APPEARANCE.fontFamily,
);

const ThemeContext = createContext<AppTheme>(defaultTheme);

export function ThemeProvider({
    children,
}: {
    children: ReactNode;
}): React.ReactElement {
    const scheme = useColorScheme();
    const themeMode = useAppearanceStore((state) => state.themeMode);
    const accentColor = useAppearanceStore((state) => state.accentColor);
    const bubbleOwnColor = useAppearanceStore(
        (state) => state.bubbleOwnColor,
    );
    const bubbleOtherColor = useAppearanceStore(
        (state) => state.bubbleOtherColor,
    );
    const bubbleRadius = useAppearanceStore((state) => state.bubbleRadius);
    const textScale = useAppearanceStore((state) => state.textScale);
    const fontId = useAppearanceStore((state) => state.fontFamily);

    // `useColorScheme` is a live subscription: switching the OS theme with
    // `themeMode: 'system'` re-renders everything immediately.
    const mode: 'light' | 'dark' =
        themeMode === 'system'
            ? scheme === 'light'
                ? 'light'
                : 'dark'
            : themeMode;

    const theme = useMemo(
        (): AppTheme =>
            buildTheme(
                mode,
                accentColor,
                bubbleOwnColor,
                bubbleOtherColor,
                bubbleRadius,
                textScale,
                fontId,
            ),
        [
            mode,
            accentColor,
            bubbleOwnColor,
            bubbleOtherColor,
            bubbleRadius,
            textScale,
            fontId,
        ],
    );

    return (
        <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    );
}

export function useTheme(): AppTheme {
    return useContext(ThemeContext);
}

/**
 * Re-provides the theme for one subtree with a different value (e.g. the
 * opaque variant used by routes that cover the app background).
 */
export function ThemeScope({
    theme,
    children,
}: {
    theme: AppTheme;
    children: ReactNode;
}): React.ReactElement {
    return (
        <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    );
}

const styleCache = new WeakMap<
    AppTheme,
    WeakMap<(theme: AppTheme) => unknown, unknown>
>();

/**
 * Memoized `StyleSheet.create` for a theme-dependent factory.
 *
 * The factory must be stable (module scope). One sheet is built per theme and
 * reused by every list row, so changing a setting rebuilds a handful of
 * sheets, not one per item.
 */
export function useThemedStyles<T extends object>(
    factory: (theme: AppTheme) => T,
): T {
    const theme = useTheme();
    let perTheme = styleCache.get(theme);
    if (perTheme === undefined) {
        perTheme = new WeakMap();
        styleCache.set(theme, perTheme);
    }
    const cached = perTheme.get(factory);
    if (cached !== undefined) {
        return cached as T;
    }
    const created = StyleSheet.create(
        factory(theme) as Record<string, object>,
    ) as unknown as T;
    perTheme.set(factory, created);
    return created;
}

/** Re-exported so components that only import this module can derive tints. */
export { withAlpha } from './colors';

/** Keyboard appearance that matches the resolved theme. */
export function keyboardAppearance(theme: AppTheme): 'light' | 'dark' {
    return theme.isDark ? 'dark' : 'light';
}
