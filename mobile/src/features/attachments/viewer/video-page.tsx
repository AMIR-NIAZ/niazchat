import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import {
    GestureDetector,
    useExclusiveGestures,
    usePanGesture,
    useTapGesture,
} from 'react-native-gesture-handler';
import type {
    PanGestureConfig,
    TapGestureConfig,
} from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
    Easing,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Pause, Play, RotateCw, Volume2, VolumeX } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { palette, radii, spacing } from '../../../shared/theme';
import { useReducedMotion } from '../../../shared/hooks/use-reduced-motion';
import {
    getVideoDownloadSnapshot,
    syncVideoDownloadFromDisk,
    useVideoDownload,
} from '../../../shared/media-cache';
import { formatDuration, hasDuration } from '../duration';
import { formatFileSize } from '../attachment-labels';
import { VideoDownloadControl } from '../video-download-control';
import { VideoPosterSurface } from '../video-poster';
import type { ViewerItem } from './viewer-model';

/**
 * One video page of the viewer.
 *
 * A player is mounted ONLY for a fully downloaded, verified local file; every
 * other state shows the blurred poster with the existing download control.
 * The player uses custom controls (no native chrome): play/pause, a draggable
 * seek bar with a time bubble, mute, speed, ±10 s double-tap on the sides and
 * a replay button at the end. Playback time lives in the control bar only, and
 * the seek preview is driven by a shared value, so dragging never re-renders
 * the page per frame.
 */

const SPEEDS = [0.5, 1, 1.5, 2] as const;
const SEEK_STEP_SECONDS = 10;
/** Chrome hides itself this long after playback starts. */
export const CHROME_IDLE_MS = 2500;
const GLASS_FILL = 'rgba(20, 10, 40, 0.62)';

interface ViewerVideoPageProps {
    item: ViewerItem;
    active: boolean;
    width: number;
    height: number;
    muted: boolean;
    /** The viewer is dismissing: playback stops immediately. */
    paused: boolean;
    /** Distance from the window bottom the control bar rests above. */
    controlsBottom: number;
    onToggleMute: () => void;
    onTap: () => void;
    onPlayingChange: (playing: boolean) => void;
}

export const ViewerVideoPage = memo(function ViewerVideoPage({
    item,
    active,
    width,
    height,
    muted,
    paused,
    controlsBottom,
    onToggleMute,
    onTap,
    onPlayingChange,
}: ViewerVideoPageProps): React.ReactElement {
    const attachment = item.attachment;
    const video = useVideoDownload(attachment);
    const reduceMotion = useReducedMotion();
    const [playError, setPlayError] = useState<string | null>(null);
    const [showPlayer, setShowPlayer] = useState(false);
    const wasReady = useRef(video.state === 'ready');
    const id = attachment.id;

    // Ready → short check window → cross-fade to the player. A video that is
    // already ready when the page mounts plays immediately.
    useEffect((): (() => void) => {
        const previous = wasReady.current;
        wasReady.current = video.state === 'ready';
        if (video.state !== 'ready') {
            setShowPlayer(false);
            return (): void => undefined;
        }
        if (reduceMotion || previous) {
            setShowPlayer(true);
            return (): void => undefined;
        }
        const timer = setTimeout((): void => setShowPlayer(true), 350);
        return (): void => clearTimeout(timer);
    }, [video.state, reduceMotion]);

    // A page that is not the current one must not keep playing.
    useEffect((): void => {
        if (!active) setShowPlayer(false);
    }, [active]);

    const handlePlayerError = useCallback((): void => {
        if (id !== null) syncVideoDownloadFromDisk(id);
        const snapshot = getVideoDownloadSnapshot(attachment);
        if (snapshot.state !== 'ready') {
            setShowPlayer(false);
            return;
        }
        setPlayError('Could not play this video.');
        setShowPlayer(false);
    }, [attachment, id]);

    if (attachment.id === null) {
        return (
            <View style={[styles.page, { width, height }]}>
                <VideoPosterSurface
                    attachment={attachment}
                    previewSize={1280}
                    variant="viewer"
                />
                <Text style={styles.statusText}>
                    This video is still uploading.
                </Text>
            </View>
        );
    }

    if (video.state === 'ready' && video.localUri !== null && showPlayer) {
        return (
            <View style={[styles.page, { width, height }]}>
                <PlayerSurface
                    key={`${item.key}-${video.localUri}`}
                    url={video.localUri}
                    width={width}
                    height={height}
                    muted={muted}
                    paused={paused}
                    controlsBottom={controlsBottom}
                    onToggleMute={onToggleMute}
                    onPlayerError={handlePlayerError}
                    onTap={onTap}
                    onPlayingChange={onPlayingChange}
                    fallbackDuration={
                        hasDuration(attachment.duration)
                            ? attachment.duration
                            : 0
                    }
                />
            </View>
        );
    }

    return (
        <View style={[styles.page, { width, height }]}>
            <VideoPosterSurface
                attachment={attachment}
                previewSize={1280}
                variant="viewer"
            />
            <VideoDownloadControl attachment={attachment} variant="viewer" />
            <VideoStatusPanel attachment={attachment} video={video} />
            {playError !== null && (
                <Text style={[styles.statusText, styles.statusTop]}>
                    {playError}
                </Text>
            )}
        </View>
    );
});

// ── not downloaded yet ──────────────────────────────────────────────────────

function VideoStatusPanel({
    attachment,
    video,
}: {
    attachment: ViewerItem['attachment'];
    video: ReturnType<typeof useVideoDownload>;
}): React.ReactElement | null {
    const state = video.state;
    if (state === 'ready') return null;
    const title =
        attachment.size > 0
            ? `Video · ${formatFileSize(attachment.size)}`
            : 'Video';
    const status = ((): string | null => {
        switch (state) {
            case 'downloading':
                return `Downloading… ${Math.round(video.progress * 100)}%`;
            case 'paused':
                return 'Paused';
            case 'queued':
                return 'Waiting…';
            case 'verifying':
                return 'Checking…';
            case 'error':
                return video.error ?? 'Download failed.';
            default:
                return null;
        }
    })();
    return (
        <View style={styles.panel} pointerEvents="box-none">
            <Text style={styles.panelTitle}>{title}</Text>
            {status !== null && (
                <Text
                    style={styles.statusText}
                    accessibilityLiveRegion="polite"
                >
                    {status}
                </Text>
            )}
            <ViewerDownloadAction video={video} />
        </View>
    );
}

function ViewerDownloadAction({
    video,
}: {
    video: ReturnType<typeof useVideoDownload>;
}): React.ReactElement | null {
    const state = video.state;
    if (state === 'verifying') return null;
    const cancelling = state === 'downloading' || state === 'queued';
    const label = cancelling
        ? 'Cancel'
        : state === 'paused'
          ? 'Resume'
          : state === 'error'
            ? 'Retry'
            : 'Download';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} download`}
            onPress={(): void => {
                if (cancelling) {
                    video.cancel();
                    return;
                }
                video.start();
            }}
            hitSlop={8}
            style={({ pressed }) => [
                styles.panelButton,
                !cancelling && styles.panelButtonPrimary,
                pressed && styles.panelButtonPressed,
            ]}
        >
            {!cancelling && (
                <LinearGradient
                    pointerEvents="none"
                    colors={[palette.primary[300], palette.primary[500]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />
            )}
            <Text style={styles.panelButtonText}>{label}</Text>
        </Pressable>
    );
}

// ── the player ──────────────────────────────────────────────────────────────

function PlayerSurface({
    url,
    width,
    height,
    muted,
    paused,
    controlsBottom,
    onToggleMute,
    onPlayerError,
    onTap,
    onPlayingChange,
    fallbackDuration,
}: {
    url: string;
    width: number;
    height: number;
    muted: boolean;
    paused: boolean;
    controlsBottom: number;
    onToggleMute: () => void;
    onPlayerError: () => void;
    onTap: () => void;
    onPlayingChange: (playing: boolean) => void;
    fallbackDuration: number;
}): React.ReactElement {
    const player = useVideoPlayer({ uri: url }, (instance): void => {
        instance.loop = false;
        instance.timeUpdateEventInterval = 0.25;
        instance.keepScreenOnWhilePlaying = true;
        instance.audioMixingMode = 'doNotMix';
        instance.muted = muted;
    });
    const onPlayerErrorRef = useRef(onPlayerError);
    onPlayerErrorRef.current = onPlayerError;

    useEffect((): void => {
        player.muted = muted;
    }, [player, muted]);

    // The viewer is closing: silence playback while the exit animation runs.
    useEffect((): void => {
        if (paused) player.pause();
    }, [paused, player]);

    // Status errors and playback state are forwarded, never thrown at React.
    useEventListener(player, 'statusChange', ({ status }): void => {
        if (status === 'error') onPlayerErrorRef.current();
    });

    // Autoplay once mounted (the file is local and verified).
    useEffect((): (() => void) => {
        player.play();
        return (): void => {
            player.pause();
        };
    }, [player]);

    // Backgrounding the app pauses; playback never continues off-screen.
    useEffect((): (() => void) => {
        const subscription = AppState.addEventListener(
            'change',
            (state): void => {
                if (state !== 'active') player.pause();
            },
        );
        return (): void => subscription.remove();
    }, [player]);

    const [ended, setEnded] = useState(false);
    useEventListener(player, 'playToEnd', (): void => {
        setEnded(true);
        onPlayingChange(false);
    });

    const replay = useCallback((): void => {
        setEnded(false);
        player.currentTime = 0;
        player.play();
    }, [player]);

    const duration = useMemo((): number => {
        const fromPlayer = player.duration;
        return fromPlayer > 0 ? fromPlayer : fallbackDuration;
    }, [player, fallbackDuration]);

    return (
        <View style={[styles.surface, { width, height }]}>
            <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls={false}
            />
            <VideoTapLayer
                player={player}
                width={width}
                onTap={onTap}
                onPlayingChange={onPlayingChange}
            />
            <VideoControls
                player={player}
                duration={duration}
                muted={muted}
                bottomInset={controlsBottom}
                onToggleMute={onToggleMute}
                ended={ended}
                onReplay={replay}
                onPlayingChange={onPlayingChange}
            />
        </View>
    );
}

// ── tap layer: single tap = chrome, double tap = play/pause or ±10 s ────────

function VideoTapLayer({
    player,
    width,
    onTap,
    onPlayingChange,
}: {
    player: VideoPlayer;
    width: number;
    onTap: () => void;
    onPlayingChange: (playing: boolean) => void;
}): React.ReactElement {
    // One flash clock for both sides; `-1` = back, `1` = forward.
    const flash = useSharedValue(0);
    const side = useSharedValue(1);

    const seek = useCallback(
        (delta: number): void => {
            const next = Math.max(0, player.currentTime + delta);
            player.currentTime = next;
        },
        [player],
    );

    const flashSide = useCallback(
        (direction: number): void => {
            side.value = direction;
            flash.value = withSequence(
                withTiming(1, {
                    duration: 110,
                    easing: Easing.out(Easing.quad),
                }),
                withDelay(320, withTiming(0, { duration: 260 })),
            );
        },
        [flash, side],
    );

    const togglePlay = useCallback((): void => {
        if (player.playing) {
            player.pause();
            onPlayingChange(false);
        } else {
            player.play();
            onPlayingChange(true);
        }
    }, [onPlayingChange, player]);

    const doubleTap = useTapGesture(
        useMemo<TapGestureConfig>(
            () => ({
                numberOfTaps: 2,
                maxDuration: 280,
                onDeactivate: (event): void => {
                    'worklet';
                    const third = width / 3;
                    if (event.x < third) {
                        scheduleOnRN(seek, -SEEK_STEP_SECONDS);
                        scheduleOnRN(flashSide, -1);
                    } else if (event.x > third * 2) {
                        scheduleOnRN(seek, SEEK_STEP_SECONDS);
                        scheduleOnRN(flashSide, 1);
                    } else {
                        scheduleOnRN(togglePlay);
                    }
                },
            }),
            [flashSide, seek, togglePlay, width],
        ),
    );

    const singleTap = useTapGesture(
        useMemo<TapGestureConfig>(
            () => ({
                numberOfTaps: 1,
                maxDistance: 12,
                onDeactivate: (): void => {
                    'worklet';
                    scheduleOnRN(onTap);
                },
            }),
            [onTap],
        ),
    );

    const gesture = useExclusiveGestures(doubleTap, singleTap);

    const leftStyle = useAnimatedStyle(() => ({
        opacity: flash.value * (side.value < 0 ? 1 : 0),
        transform: [{ scale: 0.9 + flash.value * 0.1 }],
    }));
    const rightStyle = useAnimatedStyle(() => ({
        opacity: flash.value * (side.value > 0 ? 1 : 0),
        transform: [{ scale: 0.9 + flash.value * 0.1 }],
    }));

    return (
        <GestureDetector gesture={gesture}>
            <View style={StyleSheet.absoluteFill}>
                <Animated.View
                    style={[styles.seekFlash, styles.seekFlashLeft, leftStyle]}
                    pointerEvents="none"
                >
                    <RotateCw
                        size={26}
                        color={palette.text.primary}
                        strokeWidth={2.2}
                        style={styles.flashIconBack}
                    />
                    <Text style={styles.flashText}>10</Text>
                </Animated.View>
                <Animated.View
                    style={[
                        styles.seekFlash,
                        styles.seekFlashRight,
                        rightStyle,
                    ]}
                    pointerEvents="none"
                >
                    <RotateCw
                        size={26}
                        color={palette.text.primary}
                        strokeWidth={2.2}
                    />
                    <Text style={styles.flashText}>10</Text>
                </Animated.View>
            </View>
        </GestureDetector>
    );
}

// ── controls ────────────────────────────────────────────────────────────────

const VideoControls = memo(function VideoControls({
    player,
    duration,
    muted,
    bottomInset,
    onToggleMute,
    ended,
    onReplay,
    onPlayingChange,
}: {
    player: VideoPlayer;
    duration: number;
    muted: boolean;
    bottomInset: number;
    onToggleMute: () => void;
    ended: boolean;
    onReplay: () => void;
    onPlayingChange: (playing: boolean) => void;
}): React.ReactElement {
    const reduceMotion = useReducedMotion();
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(player.playing);
    const [speedIndex, setSpeedIndex] = useState(() =>
        Math.max(
            0,
            SPEEDS.findIndex((rate) => rate === player.playbackRate),
        ),
    );
    const [trackWidth, setTrackWidth] = useState(0);
    const [bubbleSeconds, setBubbleSeconds] = useState(0);

    useEventListener(player, 'timeUpdate', ({ currentTime }): void => {
        setTime(currentTime);
    });
    useEventListener(player, 'playingChange', ({ isPlaying }): void => {
        setPlaying(isPlaying);
        onPlayingChange(isPlaying);
    });

    // Center play button: appears on toggle, fades out on its own.
    const centerOpacity = useSharedValue(0);
    const centerStyle = useAnimatedStyle(() => ({
        opacity: centerOpacity.value,
    }));

    const togglePlay = useCallback((): void => {
        if (player.playing) {
            player.pause();
        } else {
            player.play();
        }
        centerOpacity.value = reduceMotion
            ? 0
            : withSequence(
                  withTiming(1, { duration: 90 }),
                  withDelay(520, withTiming(0, { duration: 220 })),
              );
    }, [centerOpacity, player, reduceMotion]);

    const cycleSpeed = useCallback((): void => {
        const next = (speedIndex + 1) % SPEEDS.length;
        const rate = SPEEDS[next] ?? 1;
        player.playbackRate = rate;
        setSpeedIndex(next);
    }, [player, speedIndex]);

    // ── seek bar (shared values; no React state per frame) ──────────────
    const progress = useSharedValue(0);
    const dragging = useSharedValue(0);
    const [isDragging, setIsDragging] = useState(false);

    // Keep the bar in sync while playing, but never while dragging.
    useEffect((): void => {
        if (isDragging || duration <= 0) return;
        progress.value = Math.min(1, Math.max(0, time / duration));
    }, [duration, isDragging, progress, time]);

    useAnimatedReaction(
        () => Math.floor(progress.value * duration),
        (seconds, previous): void => {
            if (seconds !== previous) scheduleOnRN(setBubbleSeconds, seconds);
        },
        [duration],
    );

    const seekTo = useCallback(
        (ratio: number): void => {
            if (duration <= 0) return;
            const next = Math.min(duration, Math.max(0, ratio * duration));
            player.currentTime = next;
            setTime(next);
        },
        [duration, player],
    );

    const seekGesture = usePanGesture(
        useMemo<PanGestureConfig>(
            () => ({
                minDistance: 0,
                onBegin: (event): void => {
                    'worklet';
                    dragging.value = 1;
                    progress.value = Math.min(
                        1,
                        Math.max(0, event.x / Math.max(1, trackWidth)),
                    );
                },
                onUpdate: (event): void => {
                    'worklet';
                    progress.value = Math.min(
                        1,
                        Math.max(0, event.x / Math.max(1, trackWidth)),
                    );
                },
                onDeactivate: (): void => {
                    'worklet';
                    dragging.value = 0;
                    scheduleOnRN(seekTo, progress.value);
                },
                onFinalize: (): void => {
                    'worklet';
                    dragging.value = 0;
                },
            }),
            [dragging, progress, seekTo, trackWidth],
        ),
    );

    const beginDrag = useCallback((): void => {
        setIsDragging(true);
    }, []);
    const endDrag = useCallback((): void => {
        setIsDragging(false);
    }, []);

    const fillStyle = useAnimatedStyle(() => ({
        transform: [{ scaleX: progress.value }],
    }));
    const thumbStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: progress.value * trackWidth },
            { scale: dragging.value > 0.5 ? 1.25 : 1 },
        ],
    }));
    const bubbleStyle = useAnimatedStyle(() => ({
        opacity: dragging.value,
        transform: [
            { translateX: progress.value * trackWidth },
            { translateY: -6 * dragging.value },
        ],
    }));

    const total = duration > 0 ? duration : 0;
    const remaining = ended ? total : Math.min(time, total);
    const buffered =
        duration > 0
            ? Math.min(1, Math.max(0, player.bufferedPosition / duration))
            : 0;

    return (
        <>
            <Animated.View
                style={[styles.centerButton, centerStyle]}
                pointerEvents="none"
            >
                <View style={styles.centerCircle}>
                    {playing ? (
                        <Pause
                            size={30}
                            color={palette.text.onAccent}
                            fill={palette.text.onAccent}
                            strokeWidth={1}
                        />
                    ) : (
                        <Play
                            size={30}
                            color={palette.text.onAccent}
                            fill={palette.text.onAccent}
                            strokeWidth={1}
                        />
                    )}
                </View>
            </Animated.View>

            {ended && (
                <View style={styles.replayLayer} pointerEvents="box-none">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Replay video"
                        onPress={onReplay}
                        hitSlop={8}
                        style={styles.replayButton}
                    >
                        <RotateCw
                            size={22}
                            color={palette.text.primary}
                            strokeWidth={2.2}
                        />
                        <Text style={styles.replayText}>Replay</Text>
                    </Pressable>
                </View>
            )}

            <View style={[styles.controlBar, { bottom: bottomInset }]}>
                <View style={styles.seekRow}>
                    <Text style={styles.timeText}>
                        {formatDuration(remaining)}
                    </Text>
                    <GestureDetector gesture={seekGesture}>
                        <View
                            style={styles.seekHit}
                            onLayout={(event): void => {
                                setTrackWidth(event.nativeEvent.layout.width);
                            }}
                            onTouchStart={beginDrag}
                            onTouchEnd={endDrag}
                        >
                            <View style={styles.seekTrack}>
                                <View
                                    style={[
                                        styles.seekBuffered,
                                        {
                                            width: `${Math.round(buffered * 100)}%`,
                                        },
                                    ]}
                                />
                                <Animated.View
                                    style={[styles.seekFill, fillStyle]}
                                />
                            </View>
                            <Animated.View
                                style={[styles.seekThumb, thumbStyle]}
                            >
                                <View style={styles.seekThumbDot} />
                            </Animated.View>
                            <Animated.View
                                style={[styles.seekBubble, bubbleStyle]}
                                pointerEvents="none"
                            >
                                <Text style={styles.seekBubbleText}>
                                    {formatDuration(bubbleSeconds)}
                                </Text>
                            </Animated.View>
                        </View>
                    </GestureDetector>
                    <Text style={styles.timeText}>{formatDuration(total)}</Text>
                </View>
                <View style={styles.buttonRow}>
                    <ControlButton
                        label={playing ? 'Pause video' : 'Play video'}
                        onPress={togglePlay}
                        icon={playing ? Pause : Play}
                        filled={true}
                    />
                    <ControlButton
                        label={muted ? 'Unmute video' : 'Mute video'}
                        onPress={onToggleMute}
                        icon={muted ? VolumeX : Volume2}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Playback speed ${SPEEDS[speedIndex] ?? 1} times`}
                        onPress={cycleSpeed}
                        hitSlop={8}
                        style={styles.speedChip}
                    >
                        <Text style={styles.speedText}>
                            {SPEEDS[speedIndex] ?? 1}x
                        </Text>
                    </Pressable>
                </View>
            </View>
        </>
    );
});

function ControlButton({
    label,
    onPress,
    icon: Icon,
    filled = false,
}: {
    label: string;
    onPress: () => void;
    icon: LucideIcon;
    filled?: boolean;
}): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            hitSlop={8}
            style={({ pressed }): StyleProp<ViewStyle> => [
                styles.controlButton,
                pressed === true ? styles.controlButtonPressed : null,
            ]}
        >
            <Icon
                size={18}
                color={palette.text.primary}
                strokeWidth={2.1}
                {...(filled ? { fill: palette.text.primary } : {})}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    page: { alignItems: 'center', justifyContent: 'center' },
    surface: { alignItems: 'center', justifyContent: 'center' },
    statusText: {
        color: palette.text.secondary,
        fontSize: 13,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
    statusTop: { position: 'absolute', top: 96, start: 0, end: 0 },
    panel: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        alignItems: 'center',
        marginTop: 60,
        gap: spacing.xs,
        paddingHorizontal: spacing.lg,
    },
    panelTitle: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 14,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    panelButton: {
        marginTop: spacing.xxs,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        paddingHorizontal: spacing.lg,
        minHeight: 44,
        minWidth: 140,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    panelButtonPrimary: { borderColor: 'transparent' },
    panelButtonPressed: { opacity: 0.85 },
    panelButtonText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '600',
    },
    seekFlash: {
        position: 'absolute',
        top: '42%',
        width: 84,
        height: 84,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(20, 10, 40, 0.55)',
    },
    seekFlashLeft: { left: '6%' },
    seekFlashRight: { right: '6%' },
    flashIconBack: { transform: [{ scaleX: -1 }] },
    flashText: {
        position: 'absolute',
        color: palette.text.primary,
        fontSize: 13,
        fontWeight: '700',
    },
    centerButton: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    centerCircle: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(20, 10, 40, 0.55)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
    },
    replayLayer: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    replayButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        minHeight: 44,
        paddingHorizontal: spacing.lg,
        borderRadius: radii.full,
        backgroundColor: GLASS_FILL,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
    },
    replayText: {
        color: palette.text.primary,
        fontSize: 14,
        fontWeight: '600',
    },
    controlBar: {
        position: 'absolute',
        start: 0,
        end: 0,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        gap: spacing.xs,
        backgroundColor: GLASS_FILL,
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        borderColor: 'rgba(255,255,255,0.10)',
    },
    seekRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    timeText: {
        color: palette.text.secondary,
        fontSize: 11,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        minWidth: 34,
        textAlign: 'center',
    },
    seekHit: {
        flex: 1,
        height: 40,
        justifyContent: 'center',
    },
    seekTrack: {
        height: 4,
        borderRadius: radii.full,
        backgroundColor: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
    },
    seekBuffered: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(220,197,255,0.34)',
    },
    seekFill: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        transformOrigin: 'left',
        backgroundColor: palette.primary[300],
    },
    seekThumb: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -7,
        width: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    seekThumbDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: palette.primary[700],
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
    },
    seekBubble: {
        position: 'absolute',
        top: -26,
        left: -22,
        width: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 3,
        borderRadius: radii.sm,
        backgroundColor: palette.elevated,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.strong,
    },
    seekBubbleText: {
        color: palette.text.primary,
        fontSize: 11,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    controlButton: {
        width: 40,
        height: 40,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.10)',
    },
    controlButtonPressed: { opacity: 0.7 },
    speedChip: {
        marginStart: 'auto',
        minWidth: 44,
        minHeight: 32,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.10)',
    },
    speedText: {
        color: palette.text.primary,
        fontSize: 12,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
});
