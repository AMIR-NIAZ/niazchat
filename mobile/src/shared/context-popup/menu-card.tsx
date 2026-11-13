import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, shadows } from '../theme';
import { MENU_PADDING, MENU_ROW_HEIGHT } from './popup-layout';
import { LucideIcon } from 'lucide-react-native';

/**
 * A small floating menu: fixed-width card, 44 px rows, hairline separators and
 * a danger colour for the destructive row. Data-driven so the same card serves
 * message actions and chat-list actions.
 *
 * The size is fixed by `popup-layout.ts` constants, so the host can place the
 * card before it is rendered. Memoized: the popup must never rebuild it while
 * the animation runs.
 */

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: LucideIcon;
    destructive?: boolean;
    disabled?: boolean;
    onPress: () => void;
}
export const ContextMenuCard = memo(function ContextMenuCard({
    items,
    accessibilityLabel,
}: {
    items: readonly ContextMenuItem[];
    accessibilityLabel?: string | undefined;
}): React.ReactElement {
    return (
        <View
            accessibilityViewIsModal={true}
            accessibilityLabel={accessibilityLabel}
            style={styles.card}
        >
            {items.map((item, index) => (
                <View key={item.id}>
                    {index > 0 && <View style={styles.separator} />}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{
                            disabled: item.disabled === true,
                        }}
                        disabled={item.disabled === true}
                        onPress={item.onPress}
                        style={({ pressed }) => [
                            styles.row,
                            pressed && item.disabled !== true && styles.pressed,
                            item.disabled === true && styles.disabled,
                        ]}
                    >
                        {item.icon !== undefined && (
                            <View style={styles.icon}>
                                {React.createElement(item.icon, {
                                    size: 20,
                                    strokeWidth: 1.8,
                                    color: item.destructive === true ? '#FF453A' : '#FFFFFF',
                                })}
                            </View>
                        )}
                        <Text
                            style={[
                                styles.label,
                                item.destructive === true && styles.labelDanger,
                            ]}
                            numberOfLines={1}
                        >
                            {item.label}
                        </Text>
                    </Pressable>
                </View>
            ))}
        </View>
    );
});

const styles = StyleSheet.create({
    card: {
        borderRadius: 15,
        paddingVertical: MENU_PADDING / 2,
        backgroundColor: palette.elevated,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.strong,
        ...shadows.floating,
        shadowOpacity: 0.32,
        shadowRadius: 14,
        elevation: 10,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: MENU_ROW_HEIGHT,
        paddingHorizontal: 14,
    },
    pressed: { backgroundColor: palette.primary[100] },
    disabled: { opacity: 0.45 },
    icon: {
        width: 22,
        fontSize: 15,
        textAlign: 'center',
        color: palette.primary[600],
    },
    iconDanger: { color: palette.semantic.danger },
    label: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: palette.text.primary,
    },
    labelDanger: { color: palette.semantic.danger },
    separator: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: palette.border.subtle,
        marginStart: 14,
    },
});
