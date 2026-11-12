import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppText } from './app-text';
import { palette, radii, spacing } from '../theme';

interface SectionHeaderProps {
    title: string;
    /** Optional supporting line under the title. */
    subtitle?: string;
    actionLabel?: string;
    onAction?: () => void;
}

/** Muted uppercase section label with an optional lavender action. */
export function SectionHeader({
    title,
    subtitle,
    actionLabel,
    onAction,
}: SectionHeaderProps): React.ReactElement {
    return (
        <View style={styles.row}>
            <View style={styles.body}>
                <AppText variant="caption" style={styles.title}>
                    {title}
                </AppText>
                {subtitle !== undefined && (
                    <AppText variant="caption" style={styles.subtitle}>
                        {subtitle}
                    </AppText>
                )}
            </View>
            {actionLabel !== undefined && onAction !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={actionLabel}
                    onPress={onAction}
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.actionText}>{actionLabel}</Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xxs,
    },
    body: { flex: 1, gap: 2 },
    title: {
        color: palette.text.muted,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    subtitle: { color: palette.text.secondary, textTransform: 'none' },
    action: {
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xxs,
        borderRadius: radii.full,
    },
    actionText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    pressed: { opacity: 0.6 },
});
