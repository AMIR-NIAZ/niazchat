import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Music2, Pause, Play } from 'lucide-react-native';
import { radii, spacing } from '../../shared/theme';
import { withAlpha } from '../../shared/theme/colors';
import { useTheme, useThemedStyles } from '../../shared/theme/theme-provider';
import type { AppTheme } from '../../shared/theme/theme-provider';
import type { SharedAttachmentItemDto } from '../../core/api/dto/shared-content.dto';
import { SafeText, UserAvatar } from '../../shared/components';
import {
    MusicScrubLine,
    toggleMusicTrack,
    useIsActiveTrack,
    useMusicPlaybackStatus,
    type MusicTrack,
} from '../../shared/music-player';
import { useAttachmentAuth } from '../attachments';
import { attachmentCoverUrl } from '../attachments/attachment-url';
import { formatDuration, hasDuration } from '../attachments/duration';
import { sharedDateLabel } from './shared-content-model';

/** Track object shared with the global music player (queue + mini bar). */
export function musicTrackOf(
    item: SharedAttachmentItemDto,
    chatId: number,
): MusicTrack {
    const attachment = item.attachment;
    return {
        attachmentId: attachment.id,
        messageKey: `shared-${attachment.id}`,
        chatId,
        title: attachment.title ?? attachment.originalName,
        artist: attachment.artist ?? null,
        coverUrl: attachmentCoverUrl(attachment.coverUrl, attachment.id),
        localUri: null,
        mimeType: attachment.mimeType,
        name: attachment.originalName,
        size: attachment.size,
        durationSeconds: attachment.durationSeconds ?? null,
    };
}

/**
 * One audio track in the Music tab.
 *
 * Reuses the global music player: only one track plays app-wide, the mini bar
 * and full sheet keep working, and the row reads the shared play/pause state.
 * The cover placeholder, overlay and meta text come from the theme.
 */
export const SharedMusicRow = memo(function SharedMusicRow({
    item,
    chatId,
    queue,
    showSender,
}: {
    item: SharedAttachmentItemDto;
    chatId: number;
    queue: MusicTrack[];
    showSender: boolean;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const attachment = item.attachment;
    const { headers } = useAttachmentAuth();
    const active = useIsActiveTrack(attachment.id);
    const status = useMusicPlaybackStatus();
    const playing = active && status === 'playing';
    const loading = active && status === 'loading';
    const track = musicTrackOf(item, chatId);
    const index = Math.max(
        0,
        queue.findIndex(
            (candidate) => candidate.messageKey === track.messageKey,
        ),
    );
    const cover = attachmentCoverUrl(attachment.coverUrl, attachment.id);

    return (
        <View style={styles.wrapper}>
            <View style={styles.row}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${
                        playing ? 'Pause' : 'Play'
                    } ${track.title}`}
                    onPress={(): void => {
                        toggleMusicTrack(
                            track,
                            queue.length > 0 ? queue : [track],
                            index,
                        );
                    }}
                    style={({ pressed }) => [
                        styles.coverButton,
                        pressed && styles.pressed,
                    ]}
                >
                    {cover !== null ? (
                        <Image
                            source={{
                                uri: cover,
                                cacheKey: `music-cover-${attachment.id}`,
                                ...(headers !== undefined ? { headers } : {}),
                            }}
                            cachePolicy="memory-disk"
                            contentFit="cover"
                            style={styles.cover}
                            transition={120}
                        />
                    ) : (
                        <Music2
                            size={20}
                            color={theme.colors.accentText}
                            strokeWidth={1.8}
                        />
                    )}
                    <View style={styles.coverShade} pointerEvents="none">
                        {loading ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.accentText}
                            />
                        ) : playing ? (
                            <Pause
                                size={16}
                                color={theme.colors.accentText}
                                strokeWidth={2.2}
                                fill={theme.colors.accentText}
                            />
                        ) : (
                            <Play
                                size={16}
                                color={theme.colors.accentText}
                                strokeWidth={2.2}
                                fill={theme.colors.accentText}
                            />
                        )}
                    </View>
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
                    <SafeText style={styles.title} lines={1}>
                        {track.title}
                    </SafeText>
                    <SafeText style={styles.subtitle} lines={1}>
                        {track.artist ?? 'Unknown artist'}
                    </SafeText>
                </View>

                <View style={styles.meta}>
                    <SafeText style={styles.time} align="center">
                        {hasDuration(attachment.durationSeconds)
                            ? formatDuration(attachment.durationSeconds)
                            : ''}
                    </SafeText>
                    <SafeText style={styles.date} lines={1} align="center">
                        {sharedDateLabel(item.createdAt)}
                    </SafeText>
                </View>
            </View>
            {/* Reserved even when inactive: the row height never changes. */}
            <View style={styles.scrub}>
                {active ? <MusicScrubLine touchHeight={20} /> : null}
            </View>
        </View>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        wrapper: { paddingHorizontal: spacing.md, height: 100 },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.xs,
            height: 82,
        },
        coverButton: {
            width: 46,
            height: 46,
            borderRadius: radii.md,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.accent,
        },
        pressed: { opacity: 0.7 },
        cover: { width: '100%', height: '100%' },
        coverShade: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(theme.accent, 0.32),
        },
        body: { flex: 1, minWidth: 0, gap: 1 },
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
        title: {
            ...theme.type.label,
            color: theme.colors.text,
        },
        subtitle: {
            ...theme.type.micro,
            fontWeight: '400',
            color: theme.colors.textSecondary,
        },
        meta: { alignItems: 'flex-end', width: 92 },
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
        scrub: { height: 18, justifyContent: 'center' },
    });
