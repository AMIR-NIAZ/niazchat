import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './glass-surface';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { blur, motion, palette, radii, spacing } from '../theme';

export interface GlassTabItem {
    key: string;
    label: string;
    /** Optional glyph (emoji or character) — no icon library required. */
    glyph?: string;
    accessibilityLabel?: string;
}

interface GlassTabBarProps {
    items: GlassTabItem[];
    activeKey: string;
    onChange: (key: string) => void;
    /** Reserve the device bottom inset. Default: true. */
    withBottomInset?: boolean;
}

/**
 * Floating glass navigation bar. The active pill springs in while the label
 * brightens — a single, contained motion rather than a sliding indicator that
 * would need per-item layout measurements. Reduced motion switches instantly.
 *
 * It is a controlled presentational component: navigation wiring stays with
 * the screen that renders it.
 */
export function GlassTabBar({
    items,
    activeKey,
    onChange,
    withBottomInset = true,
}: GlassTabBarProps): React.ReactElement {
    const insets = useSafeAreaInsets();

    return (
        <View
            pointerEvents="box-none"
            style={[
                styles.wrap,
                {
                    marginBottom: withBottomInset
                        ? insets.bottom + spacing.xs
                        : spacing.xs,
                },
            ]}
        >
            <GlassSurface
                tone="header"
                intensity={blur.strong}
                radius={radii.full}
                floating={true}
                style={styles.bar}
                accessibilityRole="tablist"
            >
                <View style={styles.row}>
                    {items.map((item) => (
                        <GlassTab
                            key={item.key}
                            item={item}
                            active={item.key === activeKey}
                            onPress={(): void => onChange(item.key)}
                        />
                    ))}
                </View>
            </GlassSurface>
        </View>
    );
}

function GlassTab({
    item,
    active,
    onPress,
}: {
    item: GlassTabItem;
    active: boolean;
    onPress: () => void;
}): React.ReactElement {
    const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
    const reduceMotion = useReducedMotion();

    useEffect((): void => {
        if (reduceMotion) {
            progress.setValue(active ? 1 : 0);
            return;
        }
        progress.stopAnimation();
        Animated.spring(progress, {
            toValue: active ? 1 : 0,
            ...motion.spring,
            useNativeDriver: true,
        }).start();
    }, [active, progress, reduceMotion]);

    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected: active }}
            onPress={onPress}
            style={styles.tab}
        >
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.activePill,
                    {
                        opacity: progress,
                        transform: [
                            {
                                scale: progress.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.82, 1],
                                }),
                            },
                        ],
                    },
                ]}
            />
            <View style={styles.tabContent}>
                {item.glyph !== undefined && (
                    <Text
                        style={[styles.glyph, active && styles.glyphActive]}
                        allowFontScaling={false}
                    >
                        {item.glyph}
                    </Text>
                )}
                <Text style={[styles.label, active && styles.labelActive]}>
                    {item.label}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        left: spacing.md,
        right: spacing.md,
        bottom: 0,
    },
    bar: { padding: spacing.xxs },
    row: { flexDirection: 'row', alignItems: 'stretch' },
    tab: {
        flex: 1,
        minHeight: 52,
        borderRadius: radii.full,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    activePill: {
        position: 'absolute',
        top: 2,
        left: 2,
        right: 2,
        bottom: 2,
        borderRadius: radii.full,
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    tabContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: spacing.xs,
    },
    glyph: { fontSize: 16, color: palette.text.muted },
    glyphActive: { color: palette.primary[700] },
    label: {
        fontSize: 12,
        fontWeight: '600',
        color: palette.text.muted,
    },
    labelActive: { color: palette.highlight, fontWeight: '700' },
});
