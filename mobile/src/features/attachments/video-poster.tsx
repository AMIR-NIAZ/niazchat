import { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Film } from 'lucide-react-native';
import { palette, radii } from '../../shared/theme';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import { useVideoDownload } from '../../shared/media-cache';
import type { AttachmentView } from '../messages/messages-model';
import { attachmentPreviewUrl } from './attachment-url';
import { useAttachmentAuth } from './auth-headers';
import { formatFileSize } from './attachment-labels';
import { formatDuration, hasDuration } from './duration';

/**
 * Poster surface for a video attachment (bubble tile or viewer page).
 *
 * Visual treatment only — the download logic lives in the shared media cache:
 * - not downloaded (idle/queued/error): soft blurred poster + dark gradient so
 *   the controls stay readable;
 * - downloading: the blur eases towards sharp proportionally to progress
 *   (quantised so expo-image re-blurs rarely) and a faint shimmer sweeps
 *   across every ~1.6 s;
 * - ready: 220 ms cross-fade to the sharp poster.
 *
 * The surface is absolutely positioned, so it can never change the tile size.
 * `live: false` (context-popup copy) renders the current state statically
 * without subscribing to progress.
 */

const BLUR_SOFT = 12;
const BLUR_DOWNLOADING = 6;
const SHIMMER_PERIOD_MS = 1600;

type PosterVariant = 'tile' | 'viewer';

interface VideoPosterSurfaceProps {
    attachment: AttachmentView;
    /** Preview size for the poster URL (640 in bubbles, 1280 in the viewer). */
    previewSize: 640 | 1280;
    variant?: PosterVariant;
    live?: boolean;
}

export const VideoPosterSurface = memo(function VideoPosterSurface({
    attachment,
    previewSize,
    variant = 'tile',
    live = true,
}: VideoPosterSurfaceProps): React.ReactElement {
    const video = useVideoDownload(attachment, { live });
    const blur = posterBlur(video.state, live ? video.progress : 0);

    return (
        <View style={styles.fill} pointerEvents="none">
            <PosterImage
                attachment={attachment}
                previewSize={previewSize}
                blur={blur}
                sharp={video.state === 'ready'}
            />
            {variant === 'viewer' && (
                <LinearGradient
                    pointerEvents="none"
                    colors={[
                        'rgba(9,7,15,0.55)',
                        'rgba(9,7,15,0)',
                        'rgba(9,7,15,0.65)',
                    ]}
                    locations={[0, 0.4, 1]}
                    style={styles.fill}
                />
            )}
            {variant === 'tile' && (
                <LinearGradient
                    pointerEvents="none"
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
                    locations={[0.55, 1]}
                    style={styles.fill}
                />
            )}
            <VideoShimmer active={live && video.state === 'downloading'} />
            {variant === 'tile' && (
                <PosterChips attachment={attachment} snapshot={video} />
            )}
        </View>
    );
});

/** Blur for the current state; quantised so the image re-blurs rarely. */
function posterBlur(state: string, progress: number): number {
    if (state === 'ready') return 0;
    if (state === 'downloading') {
        const eased = BLUR_SOFT - (BLUR_SOFT - BLUR_DOWNLOADING) * progress;
        return Math.round(eased / 2) * 2;
    }
    if (state === 'verifying') return BLUR_DOWNLOADING;
    return BLUR_SOFT;
}

const PosterImage = memo(function PosterImage({
    attachment,
    previewSize,
    blur,
    sharp,
}: {
    attachment: AttachmentView;
    previewSize: 640 | 1280;
    blur: number;
    sharp: boolean;
}): React.ReactElement {
    const { headers } = useAttachmentAuth();
    const uri =
        attachment.id !== null && attachment.hasPoster === true
            ? attachmentPreviewUrl(attachment.id, previewSize)
            : undefined;

    if (uri === undefined) {
        return (
            <View style={[styles.fill, styles.placeholder]}>
                <Text style={styles.placeholderIcon}>🎬</Text>
            </View>
        );
    }

    return (
        <Image
            // The key change lets expo-image cross-fade into the sharp poster.
            key={sharp ? 'sharp' : `blur-${blur}`}
            source={{
                uri,
                ...(attachment.id !== null
                    ? { cacheKey: `att-${attachment.id}-poster` }
                    : {}),
                ...(headers !== undefined ? { headers } : {}),
            }}
            cachePolicy="memory-disk"
            contentFit={previewSize === 1280 ? 'cover' : 'cover'}
            blurRadius={blur}
            transition={sharp ? 220 : 0}
            style={styles.fill}
        />
    );
});

/** Faint diagonal sweep, ~1.6 s loop, only while bytes are arriving. */
function VideoShimmer({
    active,
}: {
    active: boolean;
}): React.ReactElement | null {
    const reduceMotion = useReducedMotion();
    const shift = useSharedValue(-1);
    const run = active && !reduceMotion;

    useEffect((): (() => void) => {
        if (!run) {
            cancelAnimation(shift);
            shift.value = -1;
            return (): void => undefined;
        }
        shift.value = withRepeat(
            withTiming(1.4, {
                duration: SHIMMER_PERIOD_MS,
                easing: Easing.inOut(Easing.quad),
            }),
            -1,
        );
        return (): void => {
            cancelAnimation(shift);
            shift.value = -1;
        };
    }, [run, shift]);

    const style = useAnimatedStyle(() => ({
        transform: [{ translateX: shift.value * 160 }],
    }));

    if (!active) return null;
    return (
        <View style={styles.shimmerClip}>
            <Animated.View style={[styles.shimmerBand, style]}>
                <LinearGradient
                    colors={[
                        'rgba(255,255,255,0)',
                        'rgba(255,255,255,0.10)',
                        'rgba(255,255,255,0)',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.fill}
                />
            </Animated.View>
        </View>
    );
}

// ── info chips ──────────────────────────────────────────────────────────────

function PosterChips({
    attachment,
    snapshot,
}: {
    attachment: AttachmentView;
    snapshot: ReturnType<typeof useVideoDownload>;
}): React.ReactElement {
    const sizeLine = ((): string => {
        if (snapshot.state === 'paused') return 'Paused';
        if (snapshot.state === 'error') return 'Retry';
        if (snapshot.state === 'downloading') {
            return snapshot.totalBytes > 0
                ? `${formatFileSize(snapshot.receivedBytes)} / ${formatFileSize(snapshot.totalBytes)}`
                : formatFileSize(snapshot.receivedBytes);
        }
        return attachment.size > 0 ? formatFileSize(attachment.size) : 'Video';
    })();

    const speed = useSmoothSpeed(snapshot);

    return (
        <>
            <View style={[styles.chip, styles.chipTopLeft]}>
                <Text style={styles.chipText} numberOfLines={1}>
                    {sizeLine}
                </Text>
            </View>
            {hasDuration(attachment.duration) && (
                <View style={[styles.chip, styles.chipBottomLeft]}>
                    <Film
                        size={10}
                        color="rgba(255,255,255,0.9)"
                        strokeWidth={2.4}
                    />
                    <Text style={styles.chipText}>
                        {formatDuration(attachment.duration)}
                    </Text>
                </View>
            )}
            {speed !== null && (
                <View style={[styles.chip, styles.chipBottomRight]}>
                    <Text style={styles.chipText} numberOfLines={1}>
                        {speed}
                    </Text>
                </View>
            )}
        </>
    );
}

/**
 * Download speed + ETA text, smoothed over the last ~3 s of throttled store
 * updates. Hidden until at least 1 s of samples; hidden while paused or done.
 */
function useSmoothSpeed(
    snapshot: ReturnType<typeof useVideoDownload>,
): string | null {
    const samples = useRef<Array<{ t: number; b: number }>>([]);
    if (snapshot.state !== 'downloading') {
        samples.current = [];
        return null;
    }
    const now = Date.now();
    const list = samples.current;
    const last = list[list.length - 1];
    if (last === undefined || last.b !== snapshot.receivedBytes) {
        list.push({ t: now, b: snapshot.receivedBytes });
    }
    while (list.length > 2 && list[0] !== undefined && now - list[0].t > 3000) {
        list.shift();
    }
    const first = list[0];
    if (first === undefined) return null;
    const spanMs = now - first.t;
    if (spanMs < 1000) return null;
    const bytesPerSec = (snapshot.receivedBytes - first.b) / (spanMs / 1000);
    if (bytesPerSec <= 0) return null;

    const speed = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    const remaining = snapshot.totalBytes - snapshot.receivedBytes;
    if (remaining <= 0) return speed;
    const seconds = Math.ceil(remaining / bytesPerSec);
    const eta =
        seconds > 90 ? `${Math.ceil(seconds / 60)}m left` : `${seconds}s left`;
    return `${speed} · ${eta}`;
}

const styles = StyleSheet.create({
    fill: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    placeholder: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.neutral[900],
    },
    placeholderIcon: { fontSize: 30 },
    shimmerClip: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
    },
    shimmerBand: {
        position: 'absolute',
        top: -40,
        bottom: -40,
        left: -120,
        width: 120,
        transform: [{ rotate: '18deg' }],
    },
    chip: {
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        minWidth: 40,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: radii.full,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    chipTopLeft: { top: 6, left: 6, maxWidth: '62%' },
    chipBottomLeft: { bottom: 6, left: 6 },
    chipBottomRight: { bottom: 6, right: 6, minWidth: 96 },
    chipText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11,
        fontWeight: '500',
        fontVariant: ['tabular-nums'],
    },
});
