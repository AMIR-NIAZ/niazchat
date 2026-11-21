import { memo } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { Music2, Pause, Play } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
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
                        <Music2 size={20} color="#FFFFFF" strokeWidth={1.8} />
                    )}
                    <View style={styles.coverShade} pointerEvents="none">
                        {loading ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : playing ? (
                            <Pause
                                size={16}
                                color="#FFFFFF"
                                strokeWidth={2.2}
                                fill="#FFFFFF"
                            />
                        ) : (
                            <Play
                                size={16}
                                color="#FFFFFF"
                                strokeWidth={2.2}
                                fill="#FFFFFF"
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
                    <Text style={styles.time}>
                        {hasDuration(attachment.durationSeconds)
                            ? formatDuration(attachment.durationSeconds)
                            : ''}
                    </Text>
                    <Text style={styles.date} numberOfLines={1}>
                        {sharedDateLabel(item.createdAt)}
                    </Text>
                </View>
            </View>
            {/* Reserved even when inactive: the row height never changes. */}
            <View style={styles.scrub}>
                {active ? <MusicScrubLine touchHeight={20} /> : null}
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
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
        backgroundColor: palette.primary[500],
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
        backgroundColor: 'rgba(9,7,15,0.32)',
    },
    body: { flex: 1, minWidth: 0, gap: 1 },
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
    title: {
        color: palette.text.primary,
        fontSize: 14,
        fontWeight: '700',
    },
    subtitle: { color: palette.text.secondary, fontSize: 11 },
    meta: { alignItems: 'flex-end', width: 92 },
    time: {
        color: palette.text.primary,
        fontSize: 11,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    date: { color: palette.text.muted, fontSize: 10, marginTop: 2 },
    scrub: { height: 18, justifyContent: 'center' },
});
