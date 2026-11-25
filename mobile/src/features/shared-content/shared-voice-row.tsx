import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { radii, spacing } from '../../shared/theme';
import { useTheme, useThemedStyles } from '../../shared/theme/theme-provider';
import type { AppTheme } from '../../shared/theme/theme-provider';
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
 *
 * The row reads the theme itself, so an accent/font/text-size change repaints
 * it even though it is memoized.
 */
export const SharedVoiceRow = memo(function SharedVoiceRow({
    item,
    showSender,
}: {
    item: SharedAttachmentItemDto;
    showSender: boolean;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                        <SafeText style={styles.progressText} align="center">
                            {`${Math.round(progress * 100)}%`}
                        </SafeText>
                    ) : (
                        <ActivityIndicator size="small" color={theme.accent} />
                    )
                ) : error !== null ? (
                    <SafeText style={styles.errorIcon} align="center">
                        !
                    </SafeText>
                ) : playing ? (
                    <Pause
                        size={16}
                        color={theme.accent}
                        strokeWidth={2.2}
                        fill={theme.accent}
                    />
                ) : (
                    <Play
                        size={16}
                        color={theme.accent}
                        strokeWidth={2.2}
                        fill={theme.accent}
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
                                            ? theme.accent
                                            : theme.colors.borderStrong,
                                },
                            ]}
                        />
                    ))}
                </View>
                {error !== null && (
                    <SafeText style={styles.errorText} lines={0}>
                        {error}
                    </SafeText>
                )}
            </View>

            <View style={styles.meta}>
                <SafeText style={styles.time} align="center">
                    {shownTime}
                </SafeText>
                <SafeText style={styles.date} lines={1} align="center">
                    {sharedDateLabel(item.createdAt)}
                </SafeText>
            </View>
        </View>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
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
            backgroundColor: theme.colors.accentSoft,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
        },
        pressed: { opacity: 0.6 },
        progressText: {
            ...theme.type.micro,
            color: theme.accent,
        },
        errorIcon: {
            ...theme.type.label,
            color: theme.colors.danger,
        },
        body: { flex: 1, minWidth: 0, gap: 3 },
        senderLine: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xxs,
            minWidth: 0,
        },
        senderName: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
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
            ...theme.type.caption,
            color: theme.colors.text,
            fontVariant: ['tabular-nums'],
        },
        date: {
            ...theme.type.micro,
            color: theme.colors.textMuted,
            marginTop: 2,
        },
        errorText: {
            ...theme.type.micro,
            color: theme.colors.danger,
        },
    });
