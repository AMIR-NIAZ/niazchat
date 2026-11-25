import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { radii, spacing } from '../../shared/theme';
import { useThemedStyles } from '../../shared/theme/theme-provider';
import type { AppTheme } from '../../shared/theme/theme-provider';
import { SafeText } from '../../shared/components';
import type { SharedProfileTab } from './shared-content-model';

export interface ProfileTabItem {
    type: SharedProfileTab;
    label: string;
}

/**
 * The sticky tab bar of the profile.
 *
 * It renders inside the profile's single list as its first data row and is
 * pinned with `stickyHeaderIndices`, so it stays under the screen header while
 * the active tab's rows scroll beneath it. The bar scrolls horizontally when
 * the labels do not fit (group profiles add a sixth tab), and keeps the active
 * tab in view.
 *
 * The bar is a translucent theme surface (never opaque), the active pill and
 * underline use the accent, and labels use the scaled typography so the chosen
 * font and text size apply.
 */
export function SharedContentTabs({
    activeTab,
    tabs,
    onChange,
}: {
    activeTab: SharedProfileTab;
    tabs: readonly ProfileTabItem[];
    onChange: (type: SharedProfileTab) => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const tabOffsets = useRef<Record<string, { x: number; width: number }>>({});

    useEffect((): void => {
        const offset = tabOffsets.current[activeTab];
        if (offset === undefined) return;
        scrollRef.current?.scrollTo({
            x: Math.max(0, offset.x - spacing.sm),
            animated: true,
        });
    }, [activeTab]);

    return (
        <View style={styles.bar}>
            <ScrollView
                ref={scrollRef}
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.content}
            >
                {tabs.map((tab) => {
                    const active = tab.type === activeTab;
                    return (
                        <Pressable
                            key={tab.type}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={tab.label}
                            onPress={(): void => onChange(tab.type)}
                            onLayout={(event): void => {
                                tabOffsets.current[tab.type] = {
                                    x: event.nativeEvent.layout.x,
                                    width: event.nativeEvent.layout.width,
                                };
                            }}
                            style={({ pressed }) => [
                                styles.tab,
                                active && styles.tabActive,
                                pressed && styles.tabPressed,
                            ]}
                        >
                            <SafeText
                                style={[
                                    styles.label,
                                    active && styles.labelActive,
                                ]}
                                align="center"
                            >
                                {tab.label}
                            </SafeText>
                            <View
                                style={[
                                    styles.indicator,
                                    active && styles.indicatorActive,
                                ]}
                            />
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        // Translucent: the global app background shows through the sticky bar.
        bar: {
            backgroundColor: theme.colors.glassHeader,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
        },
        content: {
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xxs,
            gap: spacing.xxs,
        },
        tab: {
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radii.full,
            alignItems: 'center',
            justifyContent: 'center',
        },
        tabActive: { backgroundColor: theme.colors.accentSoft },
        tabPressed: { opacity: 0.65 },
        label: {
            ...theme.type.label,
            color: theme.colors.textSecondary,
        },
        labelActive: { color: theme.accent },
        indicator: {
            marginTop: 4,
            height: 2,
            alignSelf: 'stretch',
            borderRadius: 1,
            backgroundColor: 'transparent',
        },
        indicatorActive: { backgroundColor: theme.accent },
    });
