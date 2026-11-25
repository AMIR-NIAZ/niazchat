import { createContext, useContext } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { BlurView } from 'expo-blur';
import type { BlurTint } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';
import { blur, radii, shadows } from '../theme';
import { useTheme } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';
import { useOpaqueRoute } from './opaque-route';

/**
 * The base glass surface: a translucent tinted fill plus a real native blur.
 *
 * - iOS gets the native blur material matching the active theme.
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

/**
 * The Android blur target shared with every glass surface.
 *
 * expo-blur's new API (SDK 55+) blurs a `BlurTargetView` that is referenced by
 * `blurTarget`; without one, Android falls back to `none` and logs a warning.
 * The root layout points this at the app background layer, which is what every
 * glass surface sits on top of.
 */
export const GlassBlurTargetContext = createContext<RefObject<
    ComponentRef<typeof View> | null
> | null>(null);

export function useGlassBlurTarget(): RefObject<ComponentRef<typeof View> | null> | null {
    return useContext(GlassBlurTargetContext);
}

function toneFill(tone: GlassTone, theme: AppTheme): string {
    switch (tone) {
        case 'elevated':
            return theme.colors.glassElevated;
        case 'header':
            return theme.colors.glassHeader;
        case 'accent':
            return theme.colors.glassAccent;
        default:
            return theme.colors.glassSurface;
    }
}

export function GlassSurface({
    intensity = blur.regular,
    tint,
    tone = 'surface',
    radius = radii.lg,
    bordered = true,
    floating = false,
    opacity = 1,
    style,
    children,
    ...rest
}: GlassSurfaceProps): React.ReactElement {
    const theme = useTheme();
    const blurTarget = useGlassBlurTarget();
    // Opaque routes cover the app background, so the theme already resolves
    // `toneFill` to an opaque surface: a native blur has nothing meaningful to
    // blur and would only bring the translucency back.
    const opaque = useOpaqueRoute();
    return (
        <View
            style={[
                styles.base,
                {
                    borderRadius: radius,
                    backgroundColor: toneFill(tone, theme),
                },
                opacity < 1 && { opacity },
                bordered && [
                    styles.border,
                    { borderColor: theme.colors.border },
                ],
                floating && shadows.glass,
                style,
            ]}
            {...rest}
        >
            {!opaque && (
                <BlurView
                    pointerEvents="none"
                    tint={tint ?? (theme.isDark ? 'dark' : 'light')}
                    intensity={intensity}
                    blurReductionFactor={4}
                    // `dimezisBlurViewSdk31Plus` falls back to the tint layer on older
                    // Android versions instead of rendering nothing. It requires a
                    // `blurTarget`; without one we keep the default `none` method so
                    // the native side does not warn about a missing target.
                    {...(Platform.OS === 'android' && blurTarget !== null
                        ? {
                              blurMethod: 'dimezisBlurViewSdk31Plus' as const,
                              blurTarget,
                          }
                        : {})}
                    style={StyleSheet.absoluteFill}
                />
            )}
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
    },
});
