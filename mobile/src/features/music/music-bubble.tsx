import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import {
    AlertCircle,
    Download,
    Music2,
    Pause,
    Play,
} from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import {
    toggleMusicTrack,
    useIsActiveTrack,
    useMusicPlaybackStatus,
    type MusicTrack,
} from '../../shared/music-player';
import { MusicTimeLabel } from '../../shared/music-player/music-time-label';
import { MusicScrubLine } from '../../shared/music-player/music-scrub-line';
import { useAudioDownload } from '../../shared/media-cache';
import { formatDuration } from '../attachments/duration';
import { formatFileSize } from '../attachments/attachment-labels';
import type { AttachmentView } from '../messages/messages-model';

/** Fixed row geometry: the bubble never changes height after it mounts. */
const COVER_SIZE = 52;
/** Cover + the space reserved for the scrub line under it. */
const CARD_HEIGHT = COVER_SIZE + 8;

function buildTrack(
    attachment: AttachmentView,
    queue: MusicTrack[],
    messageKey: string,
): MusicTrack {
    const fromQueue = queue.find((item) => item.messageKey === messageKey);
    return (
        fromQueue ?? {
            attachmentId: attachment.id,
            messageKey,
            chatId: null,
            title: attachment.title ?? attachment.name,
            artist: attachment.artist ?? null,
            coverUrl: attachment.coverUrl ?? null,
            localUri: attachment.localUri ?? null,
            mimeType: attachment.mimeType,
            name: attachment.name,
            size: attachment.size,
            durationSeconds: attachment.durationSeconds ?? null,
        }
    );
}

/**
 * Telegram-style music bubble: a 52 px cover that doubles as the control
 * (download / progress / play / pause / error), the track title and artist,
 * and a progress line while this is the active track.
 *
 * It subscribes to "is this the active track" + the coarse status only (both
 * stable primitives), so playback never re-renders the message list, and it
 * has a FIXED height: cover, title, artist and time line are all reserved
 * from the first render (no growth when the cover loads or the track becomes
 * active).
 */
export function MusicBubble({
    attachment,
    messageKey,
    mine,
    queue,
    isStatic = false,
    onLongPress,
}: {
    attachment: AttachmentView;
    messageKey: string;
    mine: boolean;
    queue: MusicTrack[];
    isStatic?: boolean;
    onLongPress?: (() => void) | undefined;
}): React.ReactElement {
    // Primitive selectors: an unrelated row re-renders only when THIS track is
    // the active one, never when some other track's status or position moves.
    const isActiveTrack = useIsActiveTrack(attachment.id);
    const status = useMusicPlaybackStatus();
    const download = useAudioDownload({
        id: attachment.id,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
    });
    const track = buildTrack(attachment, queue, messageKey);
    const active = !isStatic && isActiveTrack;
    const playing = active && status === 'playing';
    const loading =
        (active && status === 'loading') || download.state === 'downloading';
    const failed =
        attachment.status === 'failed' ||
        (active && status === 'error') ||
        download.state === 'error';

    const duration = attachment.durationSeconds ?? 0;

    const toggle = (): void => {
        if (isStatic || attachment.status === 'failed') return;
        const chatQueue = queue.length > 0 ? queue : [track];
        const index = Math.max(
            0,
            chatQueue.findIndex((item) => item.messageKey === messageKey),
        );
        toggleMusicTrack(track, chatQueue, index);
    };

    const glyph = ((): React.ReactElement => {
        if (attachment.status === 'uploading') {
            return (
                <Text style={styles.coverGlyph}>
                    {`${Math.round((attachment.progress ?? 0) * 100)}%`}
                </Text>
            );
        }
        if (failed) {
            return (
                <AlertCircle
                    size={22}
                    color={palette.semantic.danger}
                    strokeWidth={2.2}
                />
            );
        }
        if (loading) {
            if (download.state === 'downloading') {
                return (
                    <Text style={styles.coverGlyph}>
                        {`${Math.round(download.progress * 100)}%`}
                    </Text>
                );
            }
            return <ActivityIndicator size="small" color="#FFFFFF" />;
        }
        if (playing) {
            return (
                <Pause
                    size={22}
                    color="#FFFFFF"
                    strokeWidth={2.2}
                    fill="#FFFFFF"
                />
            );
        }
        if (download.state === 'ready' || attachment.status === 'uploaded') {
            return (
                <Play
                    size={22}
                    color="#FFFFFF"
                    strokeWidth={2.2}
                    fill="#FFFFFF"
                />
            );
        }
        return <Download size={22} color="#FFFFFF" strokeWidth={2.2} />;
    })();

    const sizeLabel =
        attachment.size > 0 ? formatFileSize(attachment.size) : null;
    const subtitle =
        duration > 0 && sizeLabel !== null
            ? `${formatDuration(duration)} · ${sizeLabel}`
            : duration > 0
              ? formatDuration(duration)
              : (sizeLabel ?? '');

    return (
        <View style={styles.card}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${
                    attachment.title ?? attachment.name
                }${loading ? ', loading' : ''}`}
                accessibilityState={{ disabled: isStatic || failed }}
                onPress={toggle}
                onLongPress={onLongPress}
                delayLongPress={LONG_PRESS_DELAY_MS}
                style={styles.coverButton}
            >
                {/* Fixed box from the first frame: the loaded cover paints
                    inside it, it never resizes the row. */}
                <View style={[styles.cover, styles.coverFallback]}>
                    {attachment.coverUrl !== null &&
                    attachment.coverUrl !== undefined ? (
                        <Image
                            source={{ uri: attachment.coverUrl }}
                            style={styles.coverImage}
                            contentFit="cover"
                            transition={120}
                        />
                    ) : (
                        <Music2
                            size={24}
                            color="rgba(255,255,255,0.86)"
                            strokeWidth={1.8}
                        />
                    )}
                </View>
                <View style={styles.coverShade} pointerEvents="none">
                    {glyph}
                </View>
            </Pressable>

            <View style={styles.meta}>
                <Text
                    style={[styles.title, mine && styles.titleMine]}
                    numberOfLines={1}
                >
                    {attachment.title ?? attachment.name}
                </Text>
                <Text
                    style={[styles.artist, mine && styles.artistMine]}
                    numberOfLines={1}
                >
                    {attachment.artist ?? 'Unknown artist'}
                </Text>
                {/* Same reserved line in both states: the row height never
                    depends on whether this track is the active one. */}
                <View style={styles.timeRow}>
                    {active ? (
                        <MusicTimeLabel
                            style={[styles.time, mine && styles.timeMine]}
                            totalSeconds={duration > 0 ? duration : null}
                            showTotal
                        />
                    ) : (
                        <Text
                            style={[styles.time, mine && styles.timeMine]}
                            numberOfLines={1}
                        >
                            {subtitle}
                        </Text>
                    )}
                </View>
            </View>

            {active ? <MusicScrubLine touchHeight={28} mine={mine} /> : null}
        </View>
    );
}

const FILL = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
};

const styles = StyleSheet.create({
    card: {
        width: 252,
        // Fixed: no reflow when the track becomes active or the cover loads.
        height: CARD_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingBottom: 8,
        position: 'relative',
    },
    coverButton: {
        width: COVER_SIZE,
        height: COVER_SIZE,
        borderRadius: radii.md,
        overflow: 'hidden',
    },
    cover: {
        width: '100%',
        height: '100%',
        backgroundColor: palette.primary[500],
    },
    coverImage: {
        width: COVER_SIZE,
        height: COVER_SIZE,
    },
    coverFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[500],
    },
    coverShade: {
        ...FILL,
        backgroundColor: 'rgba(9,7,15,0.34)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    coverGlyph: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    meta: { flex: 1, minWidth: 0, justifyContent: 'center' },
    title: {
        color: palette.neutral[900],
        fontSize: 14,
        lineHeight: 18,
        height: 18,
        fontWeight: '700',
    },
    titleMine: { color: palette.text.onAccent },
    artist: {
        color: palette.text.secondary,
        fontSize: 11,
        lineHeight: 14,
        height: 14,
        marginTop: 1,
    },
    artistMine: { color: 'rgba(255,255,255,0.78)' },
    timeRow: { height: 14, justifyContent: 'center', marginTop: 1 },
    time: {
        color: palette.text.muted,
        fontSize: 10,
        lineHeight: 13,
        fontVariant: ['tabular-nums'],
    },
    timeMine: { color: 'rgba(255,255,255,0.72)' },
});
