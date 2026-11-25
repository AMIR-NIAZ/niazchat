import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { shadows } from '../theme';
import { AppText } from '../components/app-text';
import { useTheme, useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';
import { MENU_PADDING, MENU_ROW_HEIGHT } from './popup-layout';
import { LucideIcon } from 'lucide-react-native';

/**
 * A small floating menu: fixed-width card, 44 px rows, hairline separators and
 * a danger colour for the destructive row. Data-driven so the same card serves
 * message actions and chat-list actions.
 *
 * The size is fixed by `popup-layout.ts` constants, so the host can place the
 * card before it is rendered. Memoized: the popup must never rebuild it while
 * the animation runs. It reads the theme itself, so an accent or light/dark
 * change repaints the menu immediately.
 */

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: LucideIcon;
    destructive?: boolean;
    disabled?: boolean;
    /**
     * Short right-aligned reason shown on the same row (e.g. "Download first").
     * It never changes the fixed 44 px row height the layout engine assumes.
     */
    hint?: string;
    onPress: () => void;
}
export const ContextMenuCard = memo(function ContextMenuCard({
    items,
    accessibilityLabel,
}: {
    items: readonly ContextMenuItem[];
    accessibilityLabel?: string | undefined;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                                    color:
                                        item.destructive === true
                                            ? theme.colors.danger
                                            : theme.colors.text,
                                })}
                            </View>
                        )}
                        <AppText
                            style={[
                                styles.label,
                                item.destructive === true && styles.labelDanger,
                            ]}
                            numberOfLines={1}
                        >
                            {item.label}
                        </AppText>
                        {item.hint !== undefined && (
                            <AppText style={styles.hint} numberOfLines={1}>
                                {item.hint}
                            </AppText>
                        )}
                    </Pressable>
                </View>
            ))}
        </View>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        card: {
            borderRadius: 15,
            paddingVertical: MENU_PADDING / 2,
            backgroundColor: theme.colors.surfaceElevated,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: theme.colors.borderStrong,
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
        pressed: { backgroundColor: theme.colors.glassAccent },
        disabled: { opacity: 0.45 },
        icon: {
            width: 22,
            textAlign: 'center',
        },
        label: {
            ...theme.type.label,
            flex: 1,
            fontSize: 15,
            color: theme.colors.text,
        },
        hint: {
            ...theme.type.micro,
            color: theme.colors.textMuted,
        },
        labelDanger: { color: theme.colors.danger },
        separator: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.colors.border,
            marginStart: 14,
        },
    });
