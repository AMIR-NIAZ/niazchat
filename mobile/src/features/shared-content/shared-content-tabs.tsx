import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';
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
                            <Text
                                style={[
                                    styles.label,
                                    active && styles.labelActive,
                                ]}
                            >
                                {tab.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        backgroundColor: palette.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border.subtle,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border.subtle,
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
    },
    tabActive: { backgroundColor: palette.primary[100] },
    tabPressed: { opacity: 0.65 },
    label: {
        color: palette.text.secondary,
        fontSize: 13,
        fontWeight: '600',
    },
    labelActive: { color: palette.primary[700] },
});
