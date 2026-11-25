import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/app-text';
import { radii, shadows, spacing } from '../theme';
import { useTheme, useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';
import { toneStyle as resolveToneStyle } from './dialog-tones';
import type { ToastTone } from './dialog-types';

/**
 * The toast body: a compact dark-purple pill with a tone icon. Positioning,
 * entrance/exit and the swipe-up gesture live in the host, so this leaf is
 * pure and memoized.
 */
export const ToastPill = memo(function ToastPill({
    message,
    tone,
}: {
    message: string;
    tone: ToastTone;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const toneStyle = resolveToneStyle(tone, useTheme());
    const Icon = toneStyle.icon;
    return (
        <View
            accessibilityRole="alert"
            accessibilityLabel={message}
            accessibilityLiveRegion="polite"
            style={styles.pill}
        >
            <View
                style={[styles.icon, { backgroundColor: toneStyle.wash }]}
                pointerEvents="none"
            >
                <Icon size={16} strokeWidth={2.2} color={toneStyle.color} />
            </View>
            <AppText style={styles.text} numberOfLines={3}>
                {message}
            </AppText>
        </View>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        pill: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            maxWidth: 480,
            paddingVertical: 10,
            paddingHorizontal: spacing.md,
            borderRadius: radii.full,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
            backgroundColor: theme.colors.surfaceElevated,
            ...shadows.floating,
            shadowOpacity: 0.4,
            shadowRadius: 16,
            elevation: 14,
        },
        icon: {
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
        },
        text: {
            ...theme.type.label,
            flexShrink: 1,
            fontSize: 14,
            color: theme.colors.text,
            writingDirection: 'auto',
        },
    });
