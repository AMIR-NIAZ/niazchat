import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import type { AttachmentView } from '../messages/messages-model';
import { formatDuration, hasDuration } from '../attachments/duration';
import { progressRatio, remainingSeconds, speedLabel } from './playback-model';
import { ensureVoiceCached } from './voice-cache';
import {
    cycleVoiceSpeed,
    playVoiceMessage,
    seekVoice,
    stopVoice,
    toggleVoice,
    useVoicePlayback,
} from './voice-playback';

/** Pending (local) voices get a stable negative id derived from their key. */
function playbackIdOf(attachment: AttachmentView): number {
    if (attachment.id !== null) return attachment.id;
    let hash = 0;
    for (const char of attachment.key) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return hash === 0 ? -1 : hash;
}

/**
 * Compact voice player inside a bubble: play/pause with download progress,
 * 64-bar waveform with played progress and tap-to-seek, time label and a
 * speed chip. One global player: starting this one pauses the previous.
 */
export function VoiceBubble({
    attachment,
    mine,
    onLongPress,
}: {
    attachment: AttachmentView;
    mine: boolean;
    onLongPress?: (() => void) | undefined;
}): React.ReactElement {
    const playback = useVoicePlayback();
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [width, setWidth] = useState(0);

    const playbackId = playbackIdOf(attachment);
    const active = playback.attachmentId === playbackId;
    const duration =
        attachment.duration ??
        attachment.localDuration ??
        (active ? playback.duration : 0);
    const waveform = attachment.waveform ?? attachment.localWaveform ?? null;
    const bars =
        Array.isArray(waveform) && waveform.length === 64 ? waveform : null;
    const ratio = active ? progressRatio(playback.position, duration) : 0;
    const playedBars = Math.round(ratio * 64);
    const loading = active && (playback.loading || downloading);
    const playing = active && playback.playing;

    const playbackRef = useRef(playback);
    playbackRef.current = playback;

    // Leaving the bubble (delete/scroll) stops only its own playback.
    useEffect(
        (): (() => void) => (): void => {
            if (playbackRef.current.attachmentId === playbackId) {
                stopVoice();
            }
        },
        [playbackId],
    );

    const toggle = async (): Promise<void> => {
        if (toggleVoice(playbackId)) {
            return;
        }
        setError(null);
        if (attachment.id === null) {
            if (attachment.localUri === undefined) return;
            await playVoiceMessage(playbackId, attachment.localUri, duration);
            return;
        }
        if (attachment.status !== 'uploaded') return;
        setDownloading(true);
        setDownloadProgress(0);
        try {
            const path = await ensureVoiceCached(
                attachment.id,
                attachment.mimeType,
                setDownloadProgress,
            );
            await playVoiceMessage(playbackId, path, duration);
        } catch (caught) {
            setError(
                caught instanceof Error
                    ? caught.message
                    : 'Could not play this voice message.',
            );
        } finally {
            setDownloading(false);
        }
    };

    const onWaveformLayout = (event: LayoutChangeEvent): void => {
        setWidth(event.nativeEvent.layout.width);
    };

    const seekToTap = (x: number): void => {
        if (!active || duration <= 0 || width <= 0) return;
        const next = (Math.max(0, Math.min(width, x)) / width) * duration;
        void seekVoice(next);
    };

    const timeLabel = active
        ? formatDuration(remainingSeconds(playback.position, duration))
        : hasDuration(duration)
          ? formatDuration(duration)
          : '0:00';

    const playedColor = mine ? palette.neutral[0] : palette.primary[500];
    const restColor = mine ? 'rgba(255,255,255,0.45)' : palette.neutral[300];

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Voice message, ${
                        hasDuration(duration)
                            ? formatDuration(duration)
                            : '0:00'
                    }, ${playing ? 'pause' : 'play'}`}
                    accessibilityState={{
                        disabled: attachment.status === 'failed' || loading,
                    }}
                    onPress={(): void => {
                        if (attachment.status === 'failed' || loading) return;
                        void toggle();
                    }}
                    onLongPress={onLongPress}
                    delayLongPress={LONG_PRESS_DELAY_MS}
                    style={[
                        styles.button,
                        mine ? styles.buttonMine : styles.buttonTheirs,
                    ]}
                >
                    {loading ? (
                        downloading ? (
                            <Text
                                style={[
                                    styles.progressText,
                                    mine && styles.progressTextMine,
                                ]}
                            >
                                {`${Math.round(downloadProgress * 100)}%`}
                            </Text>
                        ) : (
                            <ActivityIndicator
                                size="small"
                                color={
                                    mine
                                        ? palette.neutral[0]
                                        : palette.primary[600]
                                }
                            />
                        )
                    ) : error !== null || attachment.status === 'failed' ? (
                        <Text
                            style={[
                                styles.errorIcon,
                                mine && styles.errorIconMine,
                            ]}
                        >
                            !
                        </Text>
                    ) : (
                        <Text
                            style={[
                                styles.buttonText,
                                mine && styles.buttonTextMine,
                            ]}
                        >
                            {playing ? '❚❚' : '▶'}
                        </Text>
                    )}
                </Pressable>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Voice waveform, tap to seek"
                    onLayout={onWaveformLayout}
                    onPress={(event): void =>
                        seekToTap(event.nativeEvent.locationX)
                    }
                    onLongPress={onLongPress}
                    delayLongPress={LONG_PRESS_DELAY_MS}
                    style={styles.waveform}
                >
                    {Array.from({ length: 64 }, (_, index) => {
                        const height =
                            bars === null ? 5 : 4 + (bars[index] ?? 0) * 0.22;
                        return (
                            <View
                                key={index}
                                style={[
                                    styles.bar,
                                    {
                                        height,
                                        backgroundColor:
                                            index < playedBars
                                                ? playedColor
                                                : restColor,
                                    },
                                ]}
                            />
                        );
                    })}
                </Pressable>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Playback speed ${speedLabel(
                        playback.rate,
                    )}`}
                    accessibilityState={{ disabled: !active }}
                    onPress={active ? cycleVoiceSpeed : undefined}
                    onLongPress={onLongPress}
                    delayLongPress={LONG_PRESS_DELAY_MS}
                    style={styles.speed}
                >
                    <Text
                        style={[styles.speedText, mine && styles.speedTextMine]}
                    >
                        {speedLabel(active ? playback.rate : 1)}
                    </Text>
                </Pressable>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Voice time ${timeLabel}`}
                    onLongPress={onLongPress}
                    delayLongPress={LONG_PRESS_DELAY_MS}
                >
                    <Text style={[styles.time, mine && styles.timeMine]}>
                        {timeLabel}
                    </Text>
                </Pressable>
            </View>

            {error !== null && (
                <Text style={[styles.error, mine && styles.errorMine]}>
                    {error} Tap to retry.
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: 2 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    button: {
        width: 34,
        height: 34,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonMine: { backgroundColor: 'rgba(255,255,255,0.16)' },
    buttonTheirs: { backgroundColor: palette.primary[100] },
    buttonText: { color: palette.primary[600], fontSize: 13 },
    buttonTextMine: { color: palette.text.onAccent },
    progressText: {
        color: palette.primary[600],
        fontSize: 9,
        fontWeight: '700',
    },
    progressTextMine: { color: palette.text.onAccent },
    errorIcon: {
        color: palette.semantic.danger,
        fontSize: 15,
        fontWeight: '700',
    },
    errorIconMine: { color: palette.text.onAccent },
    waveform: {
        flex: 1,
        minWidth: 96,
        height: 30,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1.5,
    },
    bar: { width: 2, borderRadius: 2 },
    speed: {
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: radii.sm,
        backgroundColor: 'rgba(28,32,36,0.10)',
    },
    speedText: { color: palette.primary[700], fontSize: 10, fontWeight: '700' },
    speedTextMine: { color: palette.text.onAccent },
    time: {
        color: palette.neutral[500],
        fontSize: 10,
        fontVariant: ['tabular-nums'],
        minWidth: 30,
        textAlign: 'right',
    },
    timeMine: { color: 'rgba(255,255,255,0.82)' },
    error: { color: palette.semantic.danger, fontSize: 10 },
    errorMine: { color: 'rgba(255,255,255,0.82)' },
});
