import { useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import type { AttachmentView } from '../messages/messages-model';
import type { ViewerRect as ViewerOrigin } from './viewer/viewer-model';
import { measureInWindow } from '../../shared/context-popup';
import type { ViewInstance } from '../../shared/context-popup';
import { attachmentPreviewUrl } from './attachment-url';
import { useAttachmentAuth } from './auth-headers';
import {
    clearUploadProgress,
    useUploadProgress,
} from './upload-progress-store';
import { formatDuration, hasDuration } from './duration';
import { VideoDownloadControl } from './video-download-control';
import { VideoPosterSurface } from './video-poster';

export { formatDuration, hasDuration };

/**
 * Media attachments (images AND videos) inside a bubble, sharing one grid:
 * - 1: a large tile using the real aspect ratio when width/height are known;
 * - 2: side by side;
 * - 3-4: 2x2;
 * - >4: first four with a "+N" overlay on the last.
 *
 * Videos load ONLY their poster here (never the video bytes) and show the
 * download/progress/play control; a fully downloaded video opens the viewer,
 * anything else starts (or resumes/cancels) its download. A video without a
 * poster renders a placeholder tile.
 */

const LARGE_WIDTH = 240;
const LARGE_DEFAULT_HEIGHT = 180;
const CELL = 116;
const GAP = 4;

interface AttachmentGridProps {
    attachments: readonly AttachmentView[];
    /** `origin` is the tile's window rect, used by the viewer's hero animation. */
    onOpenMedia: (mediaIndex: number, origin: ViewerOrigin | null) => void;
    onLongPress?: (() => void) | undefined;
    /** Popup copy: show the overlay state without subscribing to progress. */
    static?: boolean | undefined;
}

export function AttachmentGrid({
    attachments,
    onOpenMedia,
    onLongPress,
    static: isStatic = false,
}: AttachmentGridProps): React.ReactElement {
    const { headers, refresh } = useAttachmentAuth();
    const visible = attachments.slice(0, 4);
    const extra = attachments.length - visible.length;

    return (
        <View style={styles.grid}>
            {visible.map((attachment, index) => {
                const single = visible.length === 1;
                const tileStyle = single
                    ? {
                          width: LARGE_WIDTH,
                          height: largeHeight(attachment),
                      }
                    : { width: CELL, height: CELL };
                return (
                    <MediaTile
                        key={attachment.key}
                        attachment={attachment}
                        style={tileStyle}
                        headers={headers}
                        onReloadToken={refresh}
                        label={`${attachment.kind === 'video' ? 'Video' : 'Media'} ${index + 1} of ${attachments.length}`}
                        overlay={
                            extra > 0 && index === visible.length - 1
                                ? `+${extra}`
                                : null
                        }
                        onPress={(origin): void => onOpenMedia(index, origin)}
                        onLongPress={onLongPress}
                        static={isStatic}
                    />
                );
            })}
        </View>
    );
}

function largeHeight(attachment: AttachmentView): number {
    const width = attachment.width ?? 0;
    const height = attachment.height ?? 0;
    if (width <= 0 || height <= 0) {
        return LARGE_DEFAULT_HEIGHT;
    }
    return Math.max(
        120,
        Math.min(320, Math.round((LARGE_WIDTH * height) / width)),
    );
}

interface MediaTileProps {
    attachment: AttachmentView;
    style: { width: number; height: number };
    headers: Record<string, string> | undefined;
    onReloadToken: () => Promise<Record<string, string> | undefined>;
    label: string;
    overlay: string | null;
    onPress: (origin: ViewerOrigin | null) => void;
    onLongPress?: (() => void) | undefined;
    static?: boolean | undefined;
}

function MediaTile({
    attachment,
    style,
    headers,
    onReloadToken,
    label,
    overlay,
    onPress,
    onLongPress,
    static: isStatic = false,
}: MediaTileProps): React.ReactElement {
    const tileRef = useRef<ViewInstance | null>(null);
    const [reload, setReload] = useState(0);
    const [failed, setFailed] = useState(false);
    const [reloading, setReloading] = useState(false);
    const uploadProgress = useUploadProgress(attachment.key);
    const uploading = attachment.status === 'uploading';
    const isVideo = attachment.kind === 'video';

    // Images load directly; videos render the poster surface (blur, shimmer,
    // chips) which fetches ONLY the poster — never the video bytes.
    const posterUri =
        attachment.kind === 'image'
            ? attachment.id !== null
                ? attachmentPreviewUrl(attachment.id, 640)
                : (attachment.localUri ?? undefined)
            : undefined;

    /** Press: hand the viewer the tile's rect so it can grow from it. */
    const handleOpen = (): void => {
        void measureInWindow(tileRef).then((origin): void => {
            onPress(origin);
        });
    };

    const reloadImage = (): void => {
        if (reloading) return;
        setReloading(true);
        void onReloadToken().finally((): void => {
            setReloading(false);
            setFailed(false);
            setReload((value) => value + 1);
        });
    };

    return (
        <Pressable
            ref={tileRef}
            accessibilityRole="button"
            accessibilityLabel={
                failed ? `${label}, failed to load, tap to retry` : label
            }
            onPress={failed ? reloadImage : handleOpen}
            onLongPress={onLongPress}
            delayLongPress={LONG_PRESS_DELAY_MS}
            style={[styles.tile, style]}
        >
            {isVideo ? (
                <VideoPosterSurface
                    attachment={attachment}
                    previewSize={640}
                    live={!isStatic}
                />
            ) : (
                posterUri !== undefined && (
                    <Image
                        key={`${posterUri}-${reload}`}
                        source={{
                            uri: posterUri,
                            ...(attachment.id !== null
                                ? { cacheKey: `att-${attachment.id}-thumb` }
                                : {}),
                            ...(headers !== undefined ? { headers } : {}),
                        }}
                        cachePolicy="memory-disk"
                        contentFit="cover"
                        transition={150}
                        style={styles.image}
                        onError={(): void => setFailed(true)}
                    />
                )
            )}
            {isVideo && (
                <VideoDownloadControl
                    attachment={attachment}
                    onOpen={handleOpen}
                    onLongPress={onLongPress}
                    live={!isStatic}
                />
            )}
            {failed && (
                <View style={styles.centerOverlay}>
                    {reloading ? (
                        <ActivityIndicator
                            size="small"
                            color={palette.text.onAccent}
                        />
                    ) : (
                        <Text style={styles.retryText}>Tap to retry</Text>
                    )}
                </View>
            )}
            {uploading && (
                <View style={styles.uploadOverlay}>
                    <View style={styles.progressTrack}>
                        <View
                            style={[
                                styles.progressFill,
                                {
                                    width: `${Math.round(uploadProgress * 100)}%`,
                                },
                            ]}
                        />
                    </View>
                </View>
            )}
            {attachment.status === 'failed' && (
                <View style={styles.centerOverlay}>
                    <Text style={styles.retryText} numberOfLines={2}>
                        {attachment.error ?? 'Upload failed'}
                    </Text>
                </View>
            )}
            {overlay !== null && (
                <View style={styles.countOverlay}>
                    <Text style={styles.countText}>{overlay}</Text>
                </View>
            )}
        </Pressable>
    );
}

/** Called by the hook when an attachment is cancelled (no cache left behind). */
export function resetAttachmentProgress(key: string): void {
    clearUploadProgress(key);
}

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GAP,
        marginTop: spacing.xxs,
    },
    tile: {
        borderRadius: radii.sm,
        overflow: 'hidden',
        backgroundColor: palette.neutral[100],
    },
    image: { width: '100%', height: '100%' },
    centerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(28, 32, 36, 0.45)',
    },
    retryText: {
        color: palette.text.onAccent,
        fontSize: 11,
        fontWeight: '600',
    },
    uploadOverlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: spacing.xxs,
        backgroundColor: 'rgba(28, 32, 36, 0.35)',
    },
    progressTrack: {
        height: 3,
        borderRadius: radii.full,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: palette.primary[300],
    },
    countOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(28, 32, 36, 0.55)',
    },
    countText: {
        color: palette.text.onAccent,
        fontSize: 20,
        fontWeight: '700',
    },
});
