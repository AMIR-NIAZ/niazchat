import { BlurView } from 'expo-blur';
import type { BlurTint } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';
import { blur, palette, radii, shadows } from '../theme';

/**
 * The base glass surface: a translucent tinted fill plus a real native blur.
 *
 * - iOS gets the native `dark` blur material.
 * - Android uses the Dimezis backend on SDK 31+ (older devices fall back to the
 *   tint layer, keeping the UI legible rather than blank).
 * - The fill is always translucent and sits over the screen background, so the
 *   component stays readable even when native blur is unavailable.
 * - `overflow: hidden` clips the blur to the rounded corners.
 */

export type GlassTone = 'surface' | 'elevated' | 'header' | 'accent';

interface GlassSurfaceProps extends ViewProps {
    intensity?: number;
    /** Only affects iOS; Android uses the dark blur backend. */
    tint?: BlurTint;
    tone?: GlassTone;
    radius?: number;
    bordered?: boolean;
    /** Purple-tinted drop shadow; off by default for inline cards. */
    floating?: boolean;
    /** Fill opacity multiplier, 0–1. Lower it for subtler glass. */
    opacity?: number;
}

const toneFill: Record<GlassTone, string> = {
    surface: palette.glass.surface,
    elevated: palette.glass.elevated,
    header: palette.glass.header,
    accent: palette.glass.accent,
};

export function GlassSurface({
    intensity = blur.regular,
    tint = 'dark',
    tone = 'surface',
    radius = radii.lg,
    bordered = true,
    floating = false,
    opacity = 1,
    style,
    children,
    ...rest
}: GlassSurfaceProps): React.ReactElement {
    return (
        <View
            style={[
                styles.base,
                {
                    borderRadius: radius,
                    backgroundColor: toneFill[tone],
                },
                opacity < 1 && { opacity },
                bordered && styles.border,
                floating && shadows.glass,
                style,
            ]}
            {...rest}
        >
            <BlurView
                pointerEvents="none"
                tint={tint}
                intensity={intensity}
                blurReductionFactor={4}
                // `dimezisBlurViewSdk31Plus` falls back to the tint layer on older
                // Android versions instead of rendering nothing.
                {...(Platform.OS === 'android'
                    ? { blurMethod: 'dimezisBlurViewSdk31Plus' as const }
                    : {})}
                style={StyleSheet.absoluteFill}
            />
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        overflow: 'hidden',
    },
    border: {
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.subtle,
    },
});
