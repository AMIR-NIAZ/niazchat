import type { AccentId } from '../../shared/theme/colors';
import type { FontId } from '../../shared/theme/fonts';

/**
 * Typed appearance settings. Every key is persisted by the appearance store
 * and applied app-wide through the theme provider.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type BubbleRadiusId = 'small' | 'medium' | 'large';
export type PatternId = 'dots' | 'grid' | 'diagonal';

/**
 * The user's own gallery image, stored separately from the selected
 * background.
 *
 * Keeping the file here (instead of inside `appBackground`) means selecting a
 * preset only changes the selection: the item stays in the picker with its
 * thumbnail, and its file is only deleted when it is replaced or removed.
 * Both URIs are local `file://` paths inside the app's document directory.
 */
export interface CustomAppBackground {
    /** Unique per stored file (`bg-<timestamp>`); cache-busts the thumbnail. */
    id: string;
    /** Full-size image (long edge ≤ 1600 px). */
    uri: string;
    /** Small copy (≈300 px wide) rendered in the picker grid. */
    thumbnailUri: string;
}

/**
 * One background for the whole app: painted once behind the root navigator.
 * `image` names the stored custom image by id; its URIs live in
 * `customBackground`, so the selection never owns the file.
 */
export type AppBackground =
    | { kind: 'default' }
    /** Two soft accent circles (top and bottom) on the plain canvas. */
    | { kind: 'circles' }
    | { kind: 'pattern'; id: PatternId }
    | { kind: 'gradient'; id: string }
    | { kind: 'solid'; color: string }
    | { kind: 'image'; id: string; blur: number; dim: number };

export interface AppearanceSettings {
    themeMode: ThemeMode;
    accentColor: AccentId;
    appBackground: AppBackground;
    /** The stored gallery image (present even when another preset is selected). */
    customBackground: CustomAppBackground | null;
    /** `null` = derive from the accent color. */
    bubbleOwnColor: string | null;
    /** `null` = derive from the theme surface. */
    bubbleOtherColor: string | null;
    bubbleRadius: BubbleRadiusId;
    /** 0.85 – 1.3, applied to message text and chat-list previews. */
    textScale: number;
    fontFamily: FontId;
}

export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.3;
export const TEXT_SCALE_STEPS = [0.85, 0.925, 1, 1.075, 1.15, 1.225, 1.3] as const;

export const BUBBLE_RADII: Record<BubbleRadiusId, number> = {
    small: 12,
    medium: 20,
    large: 28,
};

export const BUBBLE_RADIUS_OPTIONS = [
    { id: 'small', label: 'Small' },
    { id: 'medium', label: 'Medium' },
    { id: 'large', label: 'Large' },
] as const;

export const THEME_MODE_OPTIONS = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
] as const;

export const PATTERN_OPTIONS = [
    { id: 'dots', label: 'Dots' },
    { id: 'grid', label: 'Grid' },
    { id: 'diagonal', label: 'Diagonal' },
] as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
    themeMode: 'dark',
    accentColor: 'lavender',
    appBackground: { kind: 'circles' },
    customBackground: null,
    bubbleOwnColor: null,
    bubbleOtherColor: null,
    bubbleRadius: 'medium',
    textScale: 1,
    fontFamily: 'system',
};

/**
 * Blur / dim range shared by the background layer and the Appearance sliders.
 *
 * The slider is always 0–100 (percent), but the stored values keep their old
 * meaning: `blur` is 0–1 of the max radius and `dim` is the overlay opacity.
 */
export const APP_BACKGROUND_BLUR_MAX_RADIUS = 24;
export const APP_BACKGROUND_DIM_MAX = 0.7;
export const DEFAULT_IMAGE_BLUR = 0;
/** 40% on the slider, so the default sits exactly on a step. */
export const DEFAULT_IMAGE_DIM = 0.28;

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

/** Stored 0–1 blur fraction → 0–100 slider percent. */
export function blurToPercent(blur: number): number {
    return clamp(blur, 0, 1) * 100;
}

/** 0–100 slider percent → stored 0–1 blur fraction. */
export function percentToBlur(percent: number): number {
    return clamp(percent, 0, 100) / 100;
}

/** Stored 0–0.7 dim opacity → 0–100 slider percent. */
export function dimToPercent(dim: number): number {
    return (
        (clamp(dim, 0, APP_BACKGROUND_DIM_MAX) / APP_BACKGROUND_DIM_MAX) * 100
    );
}

/** 0–100 slider percent → stored 0–0.7 dim opacity. */
export function percentToDim(percent: number): number {
    return (clamp(percent, 0, 100) / 100) * APP_BACKGROUND_DIM_MAX;
}

/** Blur fraction → expo-image `blurRadius`, capped for Android performance. */
export function blurRadiusFor(blur: number): number {
    return Math.round(clamp(blur, 0, 1) * APP_BACKGROUND_BLUR_MAX_RADIUS);
}

/** Dim fraction → overlay opacity, capped so the photo never disappears. */
export function dimOpacityFor(dim: number): number {
    return clamp(dim, 0, APP_BACKGROUND_DIM_MAX);
}

/** Clamp/validate anything read back from storage (or a bad write). */
export function normalizeAppearance(
    input: Partial<AppearanceSettings> | undefined | null,
): AppearanceSettings {
    if (input === undefined || input === null) {
        return { ...DEFAULT_APPEARANCE };
    }
    // v1 of the store called this `chatBackground`. Accept it here too so a
    // value survives even if only the field migration path was missed.
    const legacy = input as Partial<AppearanceSettings> & {
        chatBackground?: unknown;
    };
    const themeMode: ThemeMode =
        input.themeMode === 'light' ||
        input.themeMode === 'dark' ||
        input.themeMode === 'system'
            ? input.themeMode
            : DEFAULT_APPEARANCE.themeMode;
    const accentColor: AccentId =
        typeof input.accentColor === 'string'
            ? (input.accentColor as AccentId)
            : DEFAULT_APPEARANCE.accentColor;
    const bubbleRadius: BubbleRadiusId =
        input.bubbleRadius === 'small' ||
        input.bubbleRadius === 'medium' ||
        input.bubbleRadius === 'large'
            ? input.bubbleRadius
            : DEFAULT_APPEARANCE.bubbleRadius;
    const fontFamily: FontId =
        input.fontFamily === 'system' ||
        input.fontFamily === 'vazirmatn' ||
        input.fontFamily === 'samim' ||
        input.fontFamily === 'shabnam'
            ? input.fontFamily
            : DEFAULT_APPEARANCE.fontFamily;
    const rawScale =
        typeof input.textScale === 'number' && Number.isFinite(input.textScale)
            ? input.textScale
            : DEFAULT_APPEARANCE.textScale;

    const customBackground = normalizeCustomBackground(input.customBackground);
    const appBackground = normalizeBackground(
        input.appBackground ?? legacy.chatBackground,
    );
    // An image selection without its stored file cannot paint anything: fall
    // back instead of leaving a blank canvas behind.
    const hasImageFile =
        appBackground.kind !== 'image' ||
        (customBackground !== null && customBackground.id === appBackground.id);

    return {
        themeMode,
        accentColor,
        appBackground: hasImageFile
            ? appBackground
            : DEFAULT_APPEARANCE.appBackground,
        customBackground,
        bubbleOwnColor:
            typeof input.bubbleOwnColor === 'string'
                ? input.bubbleOwnColor
                : null,
        bubbleOtherColor:
            typeof input.bubbleOtherColor === 'string'
                ? input.bubbleOtherColor
                : null,
        bubbleRadius,
        textScale: Math.min(
            TEXT_SCALE_MAX,
            Math.max(TEXT_SCALE_MIN, Math.round(rawScale * 1000) / 1000),
        ),
        fontFamily,
    };
}

function normalizeBackground(value: unknown): AppBackground {
    if (typeof value !== 'object' || value === null) {
        // No saved choice: keep today's look (the two accent circles).
        return { kind: 'circles' };
    }
    const candidate = value as Record<string, unknown>;
    switch (candidate.kind) {
        case 'circles':
            return { kind: 'circles' };
        case 'pattern':
            return candidate.id === 'dots' ||
                candidate.id === 'grid' ||
                candidate.id === 'diagonal'
                ? { kind: 'pattern', id: candidate.id }
                : { kind: 'default' };
        case 'gradient':
            return typeof candidate.id === 'string'
                ? { kind: 'gradient', id: candidate.id }
                : { kind: 'default' };
        case 'solid':
            return typeof candidate.color === 'string'
                ? { kind: 'solid', color: candidate.color }
                : { kind: 'default' };
        case 'image':
            return typeof candidate.id === 'string' && candidate.id !== ''
                ? {
                      kind: 'image',
                      id: candidate.id,
                      blur:
                          typeof candidate.blur === 'number'
                              ? Math.min(1, Math.max(0, candidate.blur))
                              : 0,
                      dim:
                          typeof candidate.dim === 'number'
                              ? Math.min(0.8, Math.max(0, candidate.dim))
                              : DEFAULT_IMAGE_DIM,
                  }
                : { kind: 'default' };
        default:
            return { kind: 'default' };
    }
}

function normalizeCustomBackground(value: unknown): CustomAppBackground | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    const uri = typeof candidate.uri === 'string' ? candidate.uri.trim() : '';
    if (uri === '') {
        return null;
    }
    const thumbnailUri =
        typeof candidate.thumbnailUri === 'string' &&
        candidate.thumbnailUri.trim() !== ''
            ? candidate.thumbnailUri.trim()
            : uri;
    return {
        id:
            typeof candidate.id === 'string' && candidate.id.trim() !== ''
                ? candidate.id.trim()
                : 'custom-image',
        uri,
        thumbnailUri,
    };
}

/**
 * A pre-separation release stored the image URI inside `appBackground`. Pull it
 * out into `customBackground` so old records keep their photo.
 */
export function legacyImageBackground(value: unknown): {
    uri: string;
    blur: number;
    dim: number;
} | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.kind !== 'image') {
        return null;
    }
    if (typeof candidate.uri !== 'string' || candidate.uri === '') {
        return null;
    }
    return {
        uri: candidate.uri,
        blur:
            typeof candidate.blur === 'number'
                ? Math.min(1, Math.max(0, candidate.blur))
                : 0,
        dim:
            typeof candidate.dim === 'number'
                ? Math.min(0.8, Math.max(0, candidate.dim))
                : DEFAULT_IMAGE_DIM,
    };
}
