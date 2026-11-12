import { Component, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    PanResponder,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radii, spacing } from '../../shared/theme';
import type { AttachmentView } from '../messages/messages-model';
import { attachmentPreviewUrl, attachmentUrl } from './attachment-url';
import { useAttachmentAuth } from './auth-headers';
import { downloadAttachment, shareLocalFile } from './file-download';
import { fetchVideoStreamUrl } from './stream-url';
import { formatDuration, hasDuration } from './attachment-grid';

/**
 * Full-screen viewer shared by images and videos of ONE message: swipe between
 * all media, "2 of 4" counter, tap/close-button/swipe-down to dismiss.
 *
 * Images load the original through the authenticated download route. Videos
 * are fetched ONLY while their page is active, via a fresh short-lived signed
 * URL, and only one player exists at a time (swiping away unmounts it).
 */

interface AttachmentViewerProps {
    visible: boolean;
    media: readonly AttachmentView[];
    initialIndex: number;
    onClose: () => void;
}

export function AttachmentViewer({
    visible,
    media,
    initialIndex,
    onClose,
}: AttachmentViewerProps): React.ReactElement {
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { headers, refresh } = useAttachmentAuth();
    const listRef = useRef<FlatList<AttachmentView>>(null);
    const [index, setIndex] = useState(initialIndex);
    const [sharing, setSharing] = useState(false);
    const [shareError, setShareError] = useState<string | null>(null);

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 60,
    }).current;
    const onViewableItemsChanged = useRef(
        (info: {
            viewableItems: Array<{ index?: number | undefined }>;
        }): void => {
            const first = info.viewableItems[0];
            if (typeof first?.index === 'number') {
                setIndex(first.index);
            }
        },
    ).current;

    useEffect((): (() => void) | void => {
        if (!visible) return;
        setIndex(initialIndex);
        setShareError(null);
        const timer = setTimeout((): void => {
            listRef.current?.scrollToOffset({
                offset: initialIndex * width,
                animated: false,
            });
        }, 0);
        return (): void => clearTimeout(timer);
    }, [visible, initialIndex, width]);

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_event, gesture): boolean =>
                gesture.dy > 60 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
            onPanResponderRelease: (_event, gesture): void => {
                if (gesture.dy > 90) {
                    onCloseRef.current();
                }
            },
        }),
    ).current;

    const current = media[index];

    const share = async (): Promise<void> => {
        if (current === undefined || current.id === null || sharing) return;
        setSharing(true);
        setShareError(null);
        try {
            const path = await downloadAttachment({
                id: current.id,
                name: current.name,
                mimeType: current.mimeType,
            });
            await shareLocalFile(path, current.mimeType, current.name);
        } catch (error) {
            setShareError(
                error instanceof Error ? error.message : 'Could not share.',
            );
        } finally {
            setSharing(false);
        }
    };

    const renderItem = ({
        item,
        index: itemIndex,
    }: ListRenderItemInfo<AttachmentView>): React.ReactElement => {
        // Only the visible page may mount a player: a closed viewer or a page
        // that was swiped away must never keep one alive.
        const active = visible && itemIndex === index;
        if (item.kind === 'video') {
            return (
                <MediaPageErrorBoundary
                    message="Can't show this video"
                    width={width}
                    height={height}
                    onClose={onClose}
                >
                    {active ? (
                        <VideoMediaPage
                            attachment={item}
                            width={width}
                            height={height}
                        />
                    ) : (
                        <VideoPosterPlaceholder
                            attachment={item}
                            width={width}
                            height={height}
                        />
                    )}
                </MediaPageErrorBoundary>
            );
        }
        const uri = item.id !== null ? attachmentUrl(item.id) : item.localUri;
        return (
            <MediaPageErrorBoundary
                message="Can't show this photo"
                width={width}
                height={height}
                onClose={onClose}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Photo ${itemIndex + 1} of ${media.length}. Tap to close`}
                    onPress={onClose}
                    style={[styles.page, { width, height }]}
                >
                    <Image
                        source={
                            uri === undefined
                                ? null
                                : {
                                      uri,
                                      ...(headers !== undefined
                                          ? { headers }
                                          : {}),
                                  }
                        }
                        cachePolicy="memory-disk"
                        contentFit="contain"
                        transition={120}
                        style={styles.image}
                        onError={(): void => {
                            void refresh();
                        }}
                    />
                </Pressable>
            </MediaPageErrorBoundary>
        );
    };

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent={false}
            onRequestClose={onClose}
        >
            <View style={styles.root} {...panResponder.panHandlers}>
                <FlatList
                    ref={listRef}
                    horizontal={true}
                    pagingEnabled={true}
                    showsHorizontalScrollIndicator={false}
                    data={[...media]}
                    keyExtractor={(item): string => item.key}
                    renderItem={renderItem}
                    viewabilityConfig={viewabilityConfig}
                    onViewableItemsChanged={onViewableItemsChanged}
                    getItemLayout={(
                        _data,
                        itemIndex,
                    ): { length: number; offset: number; index: number } => ({
                        length: width,
                        offset: width * itemIndex,
                        index: itemIndex,
                    })}
                />

                <View
                    style={[
                        styles.top,
                        { paddingTop: insets.top + spacing.sm },
                    ]}
                    pointerEvents="box-none"
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close media viewer"
                        onPress={onClose}
                        style={styles.close}
                    >
                        <Text style={styles.closeText}>✕</Text>
                    </Pressable>
                </View>

                <View
                    style={[
                        styles.footer,
                        { paddingBottom: insets.bottom + spacing.md },
                    ]}
                >
                    <Text
                        style={styles.counter}
                        accessibilityLiveRegion="polite"
                        accessibilityLabel={`Media ${index + 1} of ${media.length}`}
                    >
                        {index + 1} of {media.length}
                        {current?.kind === 'video' &&
                        hasDuration(current.duration)
                            ? ` · ${formatDuration(current.duration)}`
                            : null}
                    </Text>
                    {shareError !== null && (
                        <Text style={styles.error}>{shareError}</Text>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Share or save file"
                        onPress={(): void => {
                            void share();
                        }}
                        style={styles.shareButton}
                    >
                        {sharing ? (
                            <ActivityIndicator
                                size="small"
                                color={palette.text.onAccent}
                            />
                        ) : (
                            <Text style={styles.shareText}>Share / Save</Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

/**
 * Confines a render error to its own media page: the chat screen (and the
 * other pages) keep working, and the page shows a short message + close.
 */
class MediaPageErrorBoundary extends Component<
    {
        message: string;
        width: number;
        height: number;
        onClose: () => void;
        children: ReactNode;
    },
    { failed: boolean }
> {
    state: { failed: boolean } = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    componentDidCatch(error: unknown): void {
        if (__DEV__) {
            console.warn('Media viewer page failed to render', error);
        }
    }

    render(): ReactNode {
        if (!this.state.failed) {
            return this.props.children;
        }
        return (
            <View
                style={[
                    styles.page,
                    styles.pageFallback,
                    { width: this.props.width, height: this.props.height },
                ]}
            >
                <Text style={styles.playerError}>{this.props.message}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close media viewer"
                    onPress={this.props.onClose}
                    style={styles.retryButton}
                >
                    <Text style={styles.shareText}>Close</Text>
                </Pressable>
            </View>
        );
    }
}

function VideoPosterPlaceholder({
    attachment,
    width,
    height,
}: {
    attachment: AttachmentView;
    width: number;
    height: number;
}): React.ReactElement {
    const { headers } = useAttachmentAuth();
    const uri =
        attachment.id !== null && attachment.hasPoster === true
            ? attachmentPreviewUrl(attachment.id, 1280)
            : undefined;
    return (
        <View
            style={[styles.page, { width, height }]}
            accessibilityLabel="Video"
        >
            {uri === undefined ? (
                <Text style={styles.videoPlaceholderIcon}>🎬</Text>
            ) : (
                <Image
                    source={{
                        uri,
                        ...(headers !== undefined ? { headers } : {}),
                    }}
                    cachePolicy="memory-disk"
                    contentFit="contain"
                    style={styles.image}
                />
            )}
        </View>
    );
}

/**
 * One active video player. The signed URL is requested right before creating
 * the player and again after a playback error (expired URL). `key` changes on
 * refresh, releasing the old player.
 */
function VideoMediaPage({
    attachment,
    width,
    height,
}: {
    attachment: AttachmentView;
    width: number;
    height: number;
}): React.ReactElement {
    const [url, setUrl] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect((): (() => void) => {
        if (attachment.id === null) {
            setError('This video is still uploading.');
            return (): void => undefined;
        }
        let cancelled = false;
        setError(null);
        setUrl(null);
        void fetchVideoStreamUrl(attachment.id)
            .then((next): void => {
                if (!cancelled) setUrl(next);
            })
            .catch((caught: unknown): void => {
                if (cancelled) return;
                setError(
                    caught instanceof Error
                        ? caught.message
                        : 'Could not load this video.',
                );
            });
        return (): void => {
            cancelled = true;
        };
    }, [attachment.id, generation, attempt]);

    const retry = (): void => {
        setError(null);
        setUrl(null);
        setGeneration(0);
        setAttempt((value) => value + 1);
    };

    return (
        <View style={[styles.page, { width, height }]}>
            {error !== null ? (
                <View style={styles.errorState}>
                    <Text style={styles.playerError}>{error}</Text>
                    {attachment.id !== null && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Try loading the video again"
                            onPress={retry}
                            style={styles.retryButton}
                        >
                            <Text style={styles.shareText}>Try again</Text>
                        </Pressable>
                    )}
                </View>
            ) : url !== null ? (
                <PlayerSurface
                    key={`${attachment.key}-${generation}-${attempt}`}
                    url={url}
                    onExpired={(): void => {
                        // One fresh URL after an expiry/error; a second failure
                        // is reported instead of retrying forever.
                        if (generation === 0) {
                            setGeneration(1);
                        } else {
                            setError('Could not play this video.');
                        }
                    }}
                />
            ) : (
                <ActivityIndicator size="large" color={palette.text.onAccent} />
            )}
        </View>
    );
}

function PlayerSurface({
    url,
    onExpired,
}: {
    url: string;
    onExpired: () => void;
}): React.ReactElement {
    const player = useVideoPlayer({ uri: url }, (instance): void => {
        instance.loop = false;
    });
    const expiredRef = useRef(false);
    // Kept in a ref so a new callback identity never restarts the player.
    const onExpiredRef = useRef(onExpired);
    onExpiredRef.current = onExpired;
    const [status, setStatus] = useState(player.status);

    useEffect((): (() => void) => {
        setStatus(player.status);
        const subscription = player.addListener(
            'statusChange',
            (payload): void => {
                setStatus(payload.status);
                if (payload.status === 'error' && !expiredRef.current) {
                    expiredRef.current = true;
                    onExpiredRef.current();
                }
            },
        );
        player.play();
        return (): void => {
            subscription.remove();
            player.pause();
        };
    }, [player]);

    return (
        <View style={styles.playerSurface}>
            <VideoView
                player={player}
                style={styles.playerVideo}
                contentFit="contain"
                nativeControls={true}
                fullscreenOptions={{ enable: true }}
            />
            {status === 'loading' && (
                <View style={styles.bufferingOverlay} pointerEvents="none">
                    <ActivityIndicator
                        size="large"
                        color={palette.text.onAccent}
                    />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.neutral[900] },
    page: { alignItems: 'center', justifyContent: 'center' },
    image: { width: '100%', height: '80%' },
    videoPlaceholderIcon: { fontSize: 44 },
    playerSurface: { width: '100%', height: '80%' },
    playerVideo: { width: '100%', height: '100%' },
    bufferingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorState: {
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
    },
    pageFallback: { gap: spacing.sm, paddingHorizontal: spacing.lg },
    retryButton: {
        backgroundColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        minWidth: 120,
        alignItems: 'center',
    },
    playerError: {
        color: palette.neutral[100],
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
    top: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'flex-end',
        paddingHorizontal: spacing.md,
    },
    close: {
        width: 40,
        height: 40,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.16)',
    },
    closeText: {
        color: palette.text.onAccent,
        fontSize: 18,
        fontWeight: '600',
    },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
    },
    counter: { color: palette.neutral[100], fontSize: 13, fontWeight: '600' },
    error: { color: '#FF8A80', fontSize: 12 },
    shareButton: {
        backgroundColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        minWidth: 120,
        alignItems: 'center',
    },
    shareText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '600',
    },
});
