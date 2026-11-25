import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { recordingTimeLabel } from './recording-machine';
import { Trash2 } from 'lucide-react-native';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
import { AppText } from '../../shared/components';

/** Recording bar shown while the microphone is live (tap or hold flow). */
export function VoiceRecorderBar({
    durationMs,
    level,
    hint = 'Slide to cancel',
    onCancel,
    onSend,
}: {
    durationMs: number;
    level: number;
    hint?: string;
    onCancel: () => void;
    onSend: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const levelPercent = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`;
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect((): (() => void) => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.25,
                    duration: 600,
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 600,
                    useNativeDriver: true,
                }),
            ]),
        );
        animation.start();
        return (): void => animation.stop();
    }, [pulse]);
    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel recording"
                onPress={onCancel}
                style={styles.side}
            >
                    <Trash2 size={17} color={theme.colors.danger} />
            </Pressable>
            <Animated.View style={[styles.dot, { opacity: pulse }]} />
            <AppText style={styles.time}>{recordingTimeLabel(durationMs)}</AppText>
            <View style={styles.levelTrack}>
                <View style={[styles.levelFill, { width: levelPercent }]} />
            </View>
            <AppText style={styles.hint} numberOfLines={1}>
                {hint}
            </AppText>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop and send"
                onPress={onSend}
                style={styles.send}
            >
                <AppText style={styles.sendText}>➤</AppText>
            </Pressable>
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.lg,
        backgroundColor: theme.colors.glassSurface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    side: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    trash: { fontSize: 18 },
    dot: {
        width: 10,
        height: 10,
        borderRadius: radii.full,
        backgroundColor: theme.colors.danger,
    },
    time: {
        color: theme.colors.text,
        fontSize: 13,
        fontVariant: ['tabular-nums'],
        minWidth: 38,
    },
    levelTrack: {
        flex: 1,
        height: 4,
        borderRadius: radii.full,
        backgroundColor: theme.colors.glassElevated,
        overflow: 'hidden',
    },
    levelFill: { height: '100%', backgroundColor: theme.accent },
    hint: { color: theme.colors.textSecondary, fontSize: 11 },
    send: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.accent,
    },
    sendText: { color: theme.colors.accentText, fontSize: 14 },
});
