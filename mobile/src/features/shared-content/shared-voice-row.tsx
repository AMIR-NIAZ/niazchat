import { memo, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
import type { SharedAttachmentItemDto } from '../../core/api/dto/shared-content.dto';
import { SafeText, UserAvatar } from '../../shared/components';
import { formatDuration, hasDuration } from '../attachments/duration';
import { ensureVoiceCached } from '../voice/voice-cache';
import {
    playVoiceMessage,
    stopVoice,
    toggleVoice,
    useVoicePlayback,
} from '../voice/voice-playback';
import { sharedDateLabel } from './shared-content-model';

/**
 * One voice message in the Voice tab.
 *
 * It reuses the chat's global voice player (the same module store), so only
 * one voice plays app-wide and starting another pauses the previous. Playback
 * is from the local cache file, exactly like the bubble.
 */
export const SharedVoiceRow = memo(function SharedVoiceRow({
    item,
    showSender,
}: {
    item: SharedAttachmentItemDto;
    showSender: boolean;
}): React.ReactElement {
    const attachment = item.attachment;
    const playback = useVoicePlayback();
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const id = attachment.id;
    const active = playback.attachmentId === id;
    const playing = active && playback.playing;
    const loading = active && (playback.loading || downloading);
    const duration = hasDuration(attachment.duration)
        ? attachment.duration
        : active && playback.duration > 0
          ? playback.duration
          : 0;
    const position = active ? playback.position : 0;
    const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
    const shownTime = active
        ? formatDuration(Math.max(0, duration - position))
        : hasDuration(duration)
          ? formatDuration(duration)
          : '0:00';
    const waveform =
        Array.isArray(attachment.waveform) && attachment.waveform.length === 64
            ? attachment.waveform
            : null;
    const playedBars = Math.round(ratio * 64);

    const playbackRef = useRef(playback);
    playbackRef.current = playback;

    // The row owns playback only while IT is the active item.
    useEffect(
        (): (() => void) => (): void => {
            if (playbackRef.current.attachmentId === id) {
                stopVoice();
            }
        },
        [id],
    );

    const toggle = async (): Promise<void> => {
        if (toggleVoice(id)) return;
        setError(null);
        setDownloading(true);
        setProgress(0);
        try {
            const path = await ensureVoiceCached(
                id,
                attachment.mimeType,
                setProgress,
            );
            await playVoiceMessage(id, path, duration);
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

    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Voice message ${
                    hasDuration(duration) ? formatDuration(duration) : ''
                }, ${playing ? 'pause' : 'play'}`}
                accessibilityState={{ disabled: loading }}
                onPress={(): void => {
                    if (loading) return;
                    void toggle();
                }}
                style={({ pressed }) => [
                    styles.playButton,
                    pressed && styles.pressed,
                ]}
            >
                {loading ? (
                    downloading ? (
                        <Text style={styles.progressText}>
                            {`${Math.round(progress * 100)}%`}
                        </Text>
                    ) : (
                        <ActivityIndicator
                            size="small"
                            color={palette.primary[600]}
                        />
                    )
                ) : error !== null ? (
                    <Text style={styles.errorIcon}>!</Text>
                ) : playing ? (
                    <Pause
                        size={16}
                        color={palette.primary[600]}
                        strokeWidth={2.2}
                        fill={palette.primary[600]}
                    />
                ) : (
                    <Play
                        size={16}
                        color={palette.primary[600]}
                        strokeWidth={2.2}
                        fill={palette.primary[600]}
                    />
                )}
            </Pressable>

            <View style={styles.body}>
                {showSender && (
                    <View style={styles.senderLine}>
                        <UserAvatar
                            userId={item.sender.id}
                            name={item.sender.name || 'Member'}
                            uri={item.sender.avatarUrl}
                            size={18}
                        />
                        <SafeText style={styles.senderName} lines={1}>
                            {item.sender.name || 'Member'}
                        </SafeText>
                    </View>
                )}
                <View style={styles.waveform}>
                    {Array.from({ length: 64 }, (_, index) => (
                        <View
                            key={index}
                            style={[
                                styles.bar,
                                {
                                    height:
                                        3 + (waveform?.[index] ?? 18) * 0.16,
                                    backgroundColor:
                                        index < playedBars
                                            ? palette.primary[500]
                                            : palette.neutral[300],
                                },
                            ]}
                        />
                    ))}
                </View>
                {error !== null && (
                    <Text style={styles.errorText}>{error}</Text>
                )}
            </View>

            <View style={styles.meta}>
                <Text style={styles.time}>{shownTime}</Text>
                <Text style={styles.date} numberOfLines={1}>
                    {sharedDateLabel(item.createdAt)}
                </Text>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        height: 78,
    },
    playButton: {
        width: 40,
        height: 40,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    pressed: { opacity: 0.6 },
    progressText: {
        color: palette.primary[600],
        fontSize: 10,
        fontWeight: '700',
    },
    errorIcon: {
        color: palette.semantic.danger,
        fontSize: 15,
        fontWeight: '700',
    },
    body: { flex: 1, minWidth: 0, gap: 3 },
    senderLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
        minWidth: 0,
    },
    senderName: {
        color: palette.text.secondary,
        fontSize: 11,
        fontWeight: '600',
        flexShrink: 1,
    },
    waveform: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1,
        height: 22,
        overflow: 'hidden',
    },
    bar: { flex: 1, minWidth: 0, maxWidth: 2, borderRadius: 2 },
    meta: { alignItems: 'flex-end', width: 78 },
    time: {
        color: palette.text.primary,
        fontSize: 11,
        fontVariant: ['tabular-nums'],
        fontWeight: '600',
    },
    date: { color: palette.text.muted, fontSize: 10, marginTop: 2 },
    errorText: { color: palette.semantic.danger, fontSize: 10 },
});
