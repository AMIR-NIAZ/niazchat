import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/app-text';
import { palette, radii, shadows, spacing } from '../theme';
import { TONE_STYLES } from './dialog-tones';
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
    const toneStyle = TONE_STYLES[tone];
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

const styles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        maxWidth: 480,
        paddingVertical: 10,
        paddingHorizontal: spacing.md,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: palette.border.strong,
        backgroundColor: palette.elevated,
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
        flexShrink: 1,
        fontSize: 14,
        fontWeight: '600',
        color: palette.text.primary,
        writingDirection: 'auto',
    },
});
