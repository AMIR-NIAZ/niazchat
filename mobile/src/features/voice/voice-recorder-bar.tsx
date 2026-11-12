import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { recordingTimeLabel } from './recording-machine';

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
                <Text style={styles.trash}>🗑</Text>
            </Pressable>
            <Animated.View style={[styles.dot, { opacity: pulse }]} />
            <Text style={styles.time}>{recordingTimeLabel(durationMs)}</Text>
            <View style={styles.levelTrack}>
                <View style={[styles.levelFill, { width: levelPercent }]} />
            </View>
            <Text style={styles.hint} numberOfLines={1}>
                {hint}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop and send"
                onPress={onSend}
                style={styles.send}
            >
                <Text style={styles.sendText}>➤</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.lg,
        backgroundColor: palette.neutral[50],
        borderWidth: 1,
        borderColor: palette.neutral[100],
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
        backgroundColor: palette.semantic.danger,
    },
    time: {
        color: palette.neutral[900],
        fontSize: 13,
        fontVariant: ['tabular-nums'],
        minWidth: 38,
    },
    levelTrack: {
        flex: 1,
        height: 4,
        borderRadius: radii.full,
        backgroundColor: palette.neutral[100],
        overflow: 'hidden',
    },
    levelFill: { height: '100%', backgroundColor: palette.primary[500] },
    hint: { color: palette.neutral[500], fontSize: 11 },
    send: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[500],
    },
    sendText: { color: palette.text.onAccent, fontSize: 14 },
});
