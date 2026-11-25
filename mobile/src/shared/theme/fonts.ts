/**
 * Bundled Persian-friendly fonts.
 *
 * All three families ship under the SIL Open Font License 1.1, which allows
 * bundling inside an app (the only obligation is keeping the license notice —
 * see `assets/fonts/LICENSE.md`).
 *
 * React Native never synthesizes weights for custom font files, so a single
 * family cannot serve regular/medium/bold: every weight is its own registered
 * family name and `fontFamilyFor` maps a weight to the right one.
 */

export type FontId = 'system' | 'vazirmatn' | 'samim' | 'shabnam';

export type FontWeightKey = 'regular' | 'medium' | 'bold';

export interface FontFamilies {
    regular: string;
    medium: string;
    bold: string;
}

export interface FontOption {
    id: FontId;
    label: string;
    /** Shown under the option in the picker. */
    description: string;
    license: string;
    /** Registered families; `null` for the system font. */
    families: FontFamilies | null;
    /**
     * Extra line-height multiplier. Persian glyphs carry taller ascenders and
     * descenders than the Latin system font, so a slightly looser line box
     * prevents clipping.
     */
    lineHeightFactor: number;
}

export const FONT_OPTIONS: readonly FontOption[] = [
    {
        id: 'system',
        label: 'System default',
        description: 'The platform font, optimized for your device',
        license: 'Platform',
        families: null,
        lineHeightFactor: 1,
    },
    {
        id: 'vazirmatn',
        label: 'Vazirmatn',
        description: 'Modern, highly legible Persian + Latin',
        license: 'SIL OFL 1.1',
        families: {
            regular: 'Vazirmatn-Regular',
            medium: 'Vazirmatn-Medium',
            bold: 'Vazirmatn-Bold',
        },
        lineHeightFactor: 1.08,
    },
    {
        id: 'samim',
        label: 'Samim',
        description: 'Soft, rounded Persian with clean Latin',
        license: 'SIL OFL 1.1',
        families: {
            regular: 'Samim-Regular',
            medium: 'Samim-Medium',
            bold: 'Samim-Bold',
        },
        lineHeightFactor: 1.08,
    },
    {
        id: 'shabnam',
        label: 'Shabnam',
        description: 'Friendly Persian text face with a light Latin',
        license: 'SIL OFL 1.1',
        families: {
            regular: 'Shabnam-Regular',
            medium: 'Shabnam-Medium',
            bold: 'Shabnam-Bold',
        },
        lineHeightFactor: 1.08,
    },
] as const;

export const FONT_ASSETS = {
    'Vazirmatn-Regular': require('../../../assets/fonts/Vazirmatn-Regular.ttf'),
    'Vazirmatn-Medium': require('../../../assets/fonts/Vazirmatn-Medium.ttf'),
    'Vazirmatn-Bold': require('../../../assets/fonts/Vazirmatn-Bold.ttf'),
    'Samim-Regular': require('../../../assets/fonts/Samim-Regular.ttf'),
    'Samim-Medium': require('../../../assets/fonts/Samim-Medium.ttf'),
    'Samim-Bold': require('../../../assets/fonts/Samim-Bold.ttf'),
    'Shabnam-Regular': require('../../../assets/fonts/Shabnam-Regular.ttf'),
    'Shabnam-Medium': require('../../../assets/fonts/Shabnam-Medium.ttf'),
    'Shabnam-Bold': require('../../../assets/fonts/Shabnam-Bold.ttf'),
} as const;

export function fontOption(id: FontId): FontOption {
    return (
        FONT_OPTIONS.find((option) => option.id === id) ??
        (FONT_OPTIONS[0] as FontOption)
    );
}

/** Registered family for a custom font weight, or `undefined` for system. */
export function fontFamilyFor(
    id: FontId,
    weight: FontWeightKey,
): string | undefined {
    return fontOption(id).families?.[weight];
}

/**
 * `fontWeight` for a text style. Custom families get `'normal'` because the
 * weight lives in the family name; leaving a numeric weight on Android makes
 * it fake-bold the already-bold file.
 */
export function fontWeightFor(
    id: FontId,
    weight: FontWeightKey,
): 'normal' | '400' | '500' | '700' {
    if (fontOption(id).families === null) {
        return weight === 'regular' ? '400' : weight === 'medium' ? '500' : '700';
    }
    return 'normal';
}
