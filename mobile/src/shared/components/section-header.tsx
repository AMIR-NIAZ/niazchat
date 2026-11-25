import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { radii, spacing } from '../theme';
import { useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';

interface SectionHeaderProps {
    title: string;
    /** Optional supporting line under the title. */
    subtitle?: string;
    actionLabel?: string;
    onAction?: () => void;
}

/** Muted uppercase section label with an optional accent action. */
export function SectionHeader({
    title,
    subtitle,
    actionLabel,
    onAction,
}: SectionHeaderProps): React.ReactElement {
    const styles = useThemedStyles(createStyles);
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
                    <AppText style={styles.actionText}>{actionLabel}</AppText>
                </Pressable>
            )}
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.xxs,
        },
        body: { flex: 1, gap: 2 },
        title: {
            color: theme.colors.textMuted,
            fontWeight: '700',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
        },
        subtitle: { color: theme.colors.textSecondary, textTransform: 'none' },
        action: {
            paddingHorizontal: spacing.xs,
            paddingVertical: spacing.xxs,
            borderRadius: radii.full,
        },
        actionText: {
            ...theme.type.label,
            color: theme.accent,
        },
        pressed: { opacity: 0.6 },
    });
