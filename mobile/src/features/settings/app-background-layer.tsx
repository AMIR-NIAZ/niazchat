import { memo, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, Line, Pattern, Rect } from 'react-native-svg';
import {
    GRADIENT_PRESETS,
    relativeLuminance,
} from '../../shared/theme/colors';
import { useTheme } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
import { useOpaqueRoute } from '../../shared/components/opaque-route';
import { useAppearanceStore } from './appearance-store';
import { appBackgroundFileExists } from './app-background-storage';
import {
    DEFAULT_APPEARANCE,
    blurRadiusFor,
    dimOpacityFor,
} from './appearance-types';
import type { AppBackground, PatternId } from './appearance-types';
import type { AppBackgroundPreview } from './app-background-preview';

/**
 * The single app background.
 *
 * Mounted ONCE at the root layout, behind the navigator and every screen. It is
 * absolutely positioned over the whole window (status bar and navigation area
 * included), never sits inside a list and never re-renders on navigation: it
 * only subscribes to the one `appBackground` value and the theme.
 *
 * Screens paint a transparent canvas, so this layer is what shows through.
 * Surfaces (cards, headers, tab bar, composer, menus) keep their own opaque or
 * high-opacity fills, so text stays readable on any background.
 */

const PATTERN_SIZE = 26;

function PatternLayer({
    id,
    color,
}: {
    id: PatternId;
    color: string;
}): React.ReactElement {
    return (
        <Svg width="100%" height="100%">
            <Defs>
                {id === 'dots' && (
                    <Pattern
                        id="app-bg-dots"
                        width={PATTERN_SIZE}
                        height={PATTERN_SIZE}
                        patternUnits="userSpaceOnUse"
                    >
                        <Circle cx={2} cy={2} r={1.3} fill={color} />
                    </Pattern>
                )}
                {id === 'grid' && (
                    <Pattern
                        id="app-bg-grid"
                        width={PATTERN_SIZE}
                        height={PATTERN_SIZE}
                        patternUnits="userSpaceOnUse"
                    >
                        <Line
                            x1={0}
                            y1={0}
                            x2={PATTERN_SIZE}
                            y2={0}
                            stroke={color}
                            strokeWidth={1}
                        />
                        <Line
                            x1={0}
                            y1={0}
                            x2={0}
                            y2={PATTERN_SIZE}
                            stroke={color}
                            strokeWidth={1}
                        />
                    </Pattern>
                )}
                {id === 'diagonal' && (
                    <Pattern
                        id="app-bg-diagonal"
                        width={PATTERN_SIZE}
                        height={PATTERN_SIZE}
                        patternUnits="userSpaceOnUse"
                    >
                        <Line
                            x1={0}
                            y1={PATTERN_SIZE}
                            x2={PATTERN_SIZE}
                            y2={0}
                            stroke={color}
                            strokeWidth={1}
                        />
                    </Pattern>
                )}
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#app-bg-${id})`} />
        </Svg>
    );
}

/**
 * `true` when white status-bar / navigation icons would be hard to see.
 * Patterns and the default follow the theme; solid/gradient use WCAG relative
 * luminance. Photos are treated as dark and get a top scrim (their brightness
 * cannot be sampled reliably at runtime).
 */
export function isLightAppBackground(
    theme: AppTheme,
    background: AppBackground,
): boolean {
    switch (background.kind) {
        case 'solid':
            return relativeLuminance(background.color) > 0.45;
        case 'gradient': {
            const preset =
                GRADIENT_PRESETS.find((item) => item.id === background.id) ??
                GRADIENT_PRESETS[0];
            const average =
                preset.colors.reduce(
                    (total, color) => total + relativeLuminance(color),
                    0,
                ) / preset.colors.length;
            return average > 0.45;
        }
        case 'image':
            return false;
        default:
            return !theme.isDark;
    }
}

/**
 * Live values from the Appearance sliders, used only by the in-screen preview
 * so dragging never writes to the store. Omitted everywhere else.
 */
function AppBackgroundLayerBase({
    preview = null,
}: {
    preview?: AppBackgroundPreview | null;
}): React.ReactElement {
    const theme = useTheme();
    const background = useAppearanceStore((state) => state.appBackground);
    const customBackground = useAppearanceStore(
        (state) => state.customBackground,
    );
    const setAppBackground = useAppearanceStore(
        (state) => state.setAppBackground,
    );
    const setCustomBackground = useAppearanceStore(
        (state) => state.setCustomBackground,
    );
    const checkedRef = useRef<string | null>(null);

    // A missing image file (cleared data, restored backup) silently drops the
    // broken custom item and falls back to the default background.
    useEffect((): void => {
        if (background.kind !== 'image' || customBackground === null) {
            return;
        }
        if (checkedRef.current === customBackground.uri) {
            return;
        }
        checkedRef.current = customBackground.uri;
        void appBackgroundFileExists(customBackground.uri).then(
            (exists): void => {
                if (!exists) {
                    setCustomBackground(null);
                    setAppBackground(DEFAULT_APPEARANCE.appBackground);
                }
            },
        );
    }, [
        background,
        customBackground,
        setAppBackground,
        setCustomBackground,
    ]);

    let layer: React.ReactElement | null = null;
    let scrimOpacity = 0.14;

    switch (background.kind) {
        case 'circles':
            // The two soft accent circles that used to live in `Screen`. They
            // are part of the ONE background now, so any other choice (photo,
            // pattern, gradient, solid, plain default) really has no circles.
            layer = (
                <>
                    <View
                        style={[
                            styles.circleTop,
                            { backgroundColor: theme.colors.accentSoft },
                        ]}
                    />
                    <View
                        style={[
                            styles.circleBottom,
                            { backgroundColor: theme.colors.glassAccent },
                        ]}
                    />
                </>
            );
            // No extra wash: keep the original look of the circles.
            scrimOpacity = 0;
            break;
        case 'pattern':
            layer = (
                <PatternLayer
                    id={background.id}
                    color={theme.colors.patternTint}
                />
            );
            break;
        case 'gradient': {
            const preset =
                GRADIENT_PRESETS.find(
                    (item) => item.id === background.id,
                ) ?? GRADIENT_PRESETS[0];
            layer = (
                <LinearGradient
                    colors={[...preset.colors]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />
            );
            scrimOpacity = 0.08;
            break;
        }
        case 'solid':
            layer = (
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: background.color },
                    ]}
                />
            );
            scrimOpacity = 0.04;
            break;
        case 'image': {
            // The image's own blurRadius is far cheaper than a BlurView
            // overlay on Android, and it matches what the app layer paints.
            const blur = preview?.blur ?? background.blur;
            const dim = preview?.dim ?? background.dim;
            layer =
                customBackground === null ? null : (
                    <Image
                        source={{ uri: customBackground.uri }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={preview === null ? 160 : 0}
                        recyclingKey={customBackground.uri}
                        blurRadius={blurRadiusFor(blur)}
                        style={StyleSheet.absoluteFill}
                        accessibilityIgnoresInvertColors={true}
                    />
                );
            scrimOpacity = dimOpacityFor(dim);
            break;
        }
        default:
            layer = null;
    }

    return (
        <View
            pointerEvents="none"
            style={[
                StyleSheet.absoluteFill,
                { backgroundColor: theme.colors.background },
            ]}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
        >
            {layer !== null && (
                <View style={StyleSheet.absoluteFill}>
                    {layer}
                    {scrimOpacity > 0 && (
                        <View
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    backgroundColor: theme.isDark
                                        ? `rgba(9,7,15,${scrimOpacity})`
                                        : `rgba(255,255,255,${scrimOpacity})`,
                                },
                            ]}
                        />
                    )}
                    {background.kind === 'image' && (
                        <LinearGradient
                            colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.topScrim}
                        />
                    )}
                </View>
            )}
        </View>
    );
}

/** Status-bar / navigation-bar icon tone for the active background. */
export function useAppBackgroundIsLight(): boolean {
    const theme = useTheme();
    const background = useAppearanceStore((state) => state.appBackground);
    const opaqueRoute = useOpaqueRoute();
    // Opaque profile routes paint a plain theme canvas, so the status bar must
    // follow the theme rather than the (now hidden) background.
    if (opaqueRoute) {
        return !theme.isDark;
    }
    return isLightAppBackground(theme, background);
}

export const AppBackgroundLayer = memo(AppBackgroundLayerBase);

const styles = StyleSheet.create({
    circleTop: {
        position: 'absolute',
        top: -140,
        end: -110,
        width: 320,
        height: 320,
        borderRadius: 160,
    },
    circleBottom: {
        position: 'absolute',
        bottom: -180,
        start: -130,
        width: 360,
        height: 360,
        borderRadius: 180,
    },
    topScrim: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        height: 120,
    },
});
