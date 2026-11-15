import { memo, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import Svg, {
    Circle,
    Defs,
    LinearGradient,
    Path,
    Stop,
} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { LinearGradient as SurfaceGradient } from 'expo-linear-gradient';
import { ArrowDown, Play, RotateCw, X } from 'lucide-react-native';
import { palette, radii } from '../../shared/theme';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import { useVideoDownload } from '../../shared/media-cache';
import type { VideoDownloadState } from '../../shared/media-cache';
import type { AttachmentView } from '../messages/messages-model';

/**
 * Glass-like download / progress / play control drawn over a video poster.
 *
 * Drawing runs on the UI thread: one progress shared value (driven by the
 * throttled download store) animates the ring, and small shared values handle
 * breathing, press scale, the queued rotation, the verifying sweep, the
 * ready check-draw and the error shake. React only re-renders when the
 * throttled store emits (~10/s while downloading) or the state changes.
 *
 * The overlay is absolutely positioned and always the same size in every
 * state, so a bubble never changes its layout when the download starts,
 * pauses or finishes. `live: false` is the context-popup copy: a static icon
 * for the current state, with no loops and no subscriptions.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const TILE_SIZE = 56;
const VIEWER_SIZE = 72;
const STROKE = 3;

/** Purple gradient for the progress stroke and primary pills. */
const RING_COLORS = [palette.primary[300], palette.primary[500]] as const;
const GLASS_FILL = 'rgba(20, 10, 40, 0.55)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.14)';

export interface VideoDownloadControlProps {
    attachment: AttachmentView;
    variant?: 'tile' | 'viewer';
    /** Subscribe to live progress (false for the static popup copy). */
    live?: boolean;
    /** Opens the viewer; only ever called for a `ready` video. */
    onOpen?: (() => void) | undefined;
    /** Bubble long-press (context popup); the control owns video taps. */
    onLongPress?: (() => void) | undefined;
}

export const VideoDownloadControl = memo(function VideoDownloadControl({
    attachment,
    variant = 'tile',
    live = true,
    onOpen,
    onLongPress,
}: VideoDownloadControlProps): React.ReactElement {
    const video = useVideoDownload(attachment, { live });
    const reduceMotion = useReducedMotion();
    const size = variant === 'viewer' ? VIEWER_SIZE : TILE_SIZE;

    const press = useSharedValue(1);
    const breathe = useSharedValue(1);
    const shake = useSharedValue(0);
    const prevState = useRef<VideoDownloadState | null>(null);

    const state = video.state;

    // Haptics once per transition (never on the static popup copy).
    useEffect((): void => {
        const before = prevState.current;
        prevState.current = state;
        if (!live || before === null || before === state) return;
        if (state === 'ready') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                (): void => undefined,
            );
        } else if (state === 'error') {
            Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
            ).catch((): void => undefined);
        }
    }, [state, live]);

    // Idle breathing: invites the tap, stops after 6 s or without motion.
    useEffect((): (() => void) => {
        if (!live || state !== 'idle' || reduceMotion) {
            cancelAnimation(breathe);
            breathe.value = 1;
            return (): void => undefined;
        }
        breathe.value = withRepeat(
            withSequence(
                withTiming(1.06, {
                    duration: 900,
                    easing: Easing.inOut(Easing.quad),
                }),
                withTiming(1, {
                    duration: 900,
                    easing: Easing.inOut(Easing.quad),
                }),
            ),
            -1,
        );
        const stop = setTimeout((): void => {
            cancelAnimation(breathe);
            breathe.value = withTiming(1, { duration: 120 });
        }, 6000);
        return (): void => {
            clearTimeout(stop);
            cancelAnimation(breathe);
            breathe.value = 1;
        };
    }, [live, state, reduceMotion, breathe]);

    // Error shake: ±4 px, 3 oscillations, ~280 ms, once per error entry.
    useEffect((): (() => void) => {
        if (!live || state !== 'error') {
            shake.value = 0;
            return (): void => undefined;
        }
        if (reduceMotion) {
            shake.value = 0;
            return (): void => undefined;
        }
        const step = { duration: 46, easing: Easing.linear };
        shake.value = withSequence(
            withTiming(-4, step),
            withTiming(4, step),
            withTiming(-4, step),
            withTiming(4, step),
            withTiming(-4, step),
            withTiming(4, step),
            withTiming(0, step),
        );
        return (): void => {
            cancelAnimation(shake);
            shake.value = 0;
        };
    }, [live, state, reduceMotion, shake]);

    const handlePressIn = (): void => {
        press.value = reduceMotion
            ? 1
            : withSpring(0.92, { damping: 18, stiffness: 300 });
    };
    const handlePressOut = (): void => {
        press.value = withSpring(1, { damping: 16, stiffness: 260 });
    };

    const handlePress = (): void => {
        if (video.state === 'ready') {
            onOpen?.();
            return;
        }
        if (video.state === 'downloading' || video.state === 'queued') {
            video.cancel();
            return;
        }
        // idle / paused / error: start or resume from the `.part` on disk.
        video.start();
    };

    const circleStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: shake.value },
            { scale: breathe.value * press.value },
        ],
    }));

    return (
        <View
            style={[
                styles.overlay,
                variant === 'viewer' && styles.overlayViewer,
            ]}
            pointerEvents={live ? 'box-none' : 'none'}
        >
            <Animated.View style={circleStyle}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel(video, attachment)}
                    accessibilityLiveRegion="polite"
                    onPress={handlePress}
                    onPressIn={handlePressIn}
                    onPressOut={handlePressOut}
                    onLongPress={onLongPress}
                    hitSlop={8}
                    disabled={!live}
                    style={styles.pressable}
                >
                    <View
                        style={[
                            styles.circle,
                            {
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                            },
                            video.state === 'error' && styles.circleError,
                        ]}
                    >
                        <SurfaceGradient
                            pointerEvents="none"
                            colors={[
                                'rgba(117,69,184,0.25)',
                                'rgba(117,69,184,0)',
                            ]}
                            style={styles.circleGradient}
                        />
                        <ProgressRing
                            size={size}
                            state={state}
                            progress={video.progress}
                            live={live}
                        />
                        <StateIcon
                            key={state}
                            state={state}
                            entered={live}
                            reduceMotion={reduceMotion}
                        />
                    </View>
                </Pressable>
            </Animated.View>
        </View>
    );
});

function accessibilityLabel(
    snapshot: {
        state: VideoDownloadState;
        progress: number;
        error: string | null;
    },
    attachment: AttachmentView,
): string {
    const megabytes =
        attachment.size > 0
            ? ` ${(attachment.size / (1024 * 1024)).toFixed(1)} megabytes`
            : '';
    switch (snapshot.state) {
        case 'ready':
            return 'Play video';
        case 'queued':
            return 'Download video, waiting in queue';
        case 'downloading':
            return `Cancel download, ${Math.round(snapshot.progress * 100)} percent`;
        case 'paused':
            return 'Resume download';
        case 'verifying':
            return 'Checking the downloaded video';
        case 'error':
            return 'Retry download';
        default:
            return `Download video,${megabytes}`;
    }
}

// ── progress ring ───────────────────────────────────────────────────────────

function ProgressRing({
    size,
    state,
    progress,
    live,
}: {
    size: number;
    state: VideoDownloadState;
    progress: number;
    live: boolean;
}): React.ReactElement {
    const reduceMotion = useReducedMotion();
    const stroke = STROKE;
    const radius = (size - stroke) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    const ring = useSharedValue(0);
    const queuedSpin = useSharedValue(0);
    const sweepSpin = useSharedValue(0);
    const prevState = useRef<VideoDownloadState | null>(null);

    useEffect((): void => {
        const before = prevState.current;
        prevState.current = state;
        if (!live) return;

        if (state === 'queued' || state === 'idle') {
            if (before !== 'queued' && before !== 'idle') ring.value = 0;
            return;
        }
        if (state === 'downloading') {
            // Smoothly catch up, never backwards across a reset.
            const target =
                before === 'queued' || before === 'idle'
                    ? progress
                    : Math.max(ring.value, progress);
            ring.value = reduceMotion
                ? target
                : withTiming(target, {
                      duration: 180,
                      easing: Easing.linear,
                  });
            return;
        }
        if (state === 'verifying' || state === 'ready') {
            ring.value = reduceMotion
                ? 1
                : withTiming(1, { duration: 150, easing: Easing.linear });
            return;
        }
        // paused keeps the frozen ring; error fades it out.
        if (state === 'error') {
            ring.value = reduceMotion ? 0 : withTiming(0, { duration: 200 });
        }
    }, [state, progress, live, reduceMotion, ring]);

    // Queued: a thin dashed ring slowly rotating.
    useEffect((): (() => void) => {
        if (!live || state !== 'queued' || reduceMotion) {
            cancelAnimation(queuedSpin);
            queuedSpin.value = 0;
            return (): void => undefined;
        }
        queuedSpin.value = withRepeat(
            withTiming(360, { duration: 3000, easing: Easing.linear }),
            -1,
        );
        return (): void => {
            cancelAnimation(queuedSpin);
            queuedSpin.value = 0;
        };
    }, [live, state, reduceMotion, queuedSpin]);

    // Verifying: a short indeterminate sweep after the ring completes.
    useEffect((): (() => void) => {
        if (!live || state !== 'verifying' || reduceMotion) {
            cancelAnimation(sweepSpin);
            sweepSpin.value = 0;
            return (): void => undefined;
        }
        sweepSpin.value = withRepeat(
            withTiming(360, { duration: 520, easing: Easing.linear }),
            -1,
        );
        return (): void => {
            cancelAnimation(sweepSpin);
            sweepSpin.value = 0;
        };
    }, [live, state, reduceMotion, sweepSpin]);

    const showsTrack =
        state === 'downloading' ||
        state === 'paused' ||
        state === 'verifying' ||
        state === 'ready';
    const showsArc = showsTrack && state !== 'ready';

    const arcProps = useAnimatedProps(() => ({
        strokeDashoffset: circumference * (1 - ring.value),
    }));
    const headAngle = useAnimatedProps(() => {
        const angle = 2 * Math.PI * ring.value - Math.PI / 2;
        return {
            cx: center + radius * Math.cos(angle),
            cy: center + radius * Math.sin(angle),
        };
    });
    const queuedProps = useAnimatedStyle(() => ({
        transform: [{ rotate: `${queuedSpin.value}deg` }],
    }));
    const sweepProps = useAnimatedStyle(() => ({
        transform: [{ rotate: `${sweepSpin.value}deg` }],
    }));

    return (
        <View style={styles.ringWrap} pointerEvents="none">
            {state === 'queued' && (
                <Animated.View style={[StyleSheet.absoluteFill, queuedProps]}>
                    <Svg width={size} height={size}>
                        <Circle
                            cx={center}
                            cy={center}
                            r={radius}
                            stroke="rgba(255,255,255,0.35)"
                            strokeWidth={stroke}
                            fill="transparent"
                            strokeDasharray={`${circumference * 0.12} ${circumference * 0.09}`}
                            strokeLinecap="round"
                        />
                    </Svg>
                </Animated.View>
            )}
            {state === 'verifying' && (
                <Animated.View style={[StyleSheet.absoluteFill, sweepProps]}>
                    <Svg width={size} height={size}>
                        <Circle
                            cx={center}
                            cy={center}
                            r={radius}
                            stroke={RING_COLORS[0]}
                            strokeWidth={stroke}
                            fill="transparent"
                            strokeDasharray={`${circumference * 0.22} ${circumference * 0.78}`}
                            strokeLinecap="round"
                        />
                    </Svg>
                </Animated.View>
            )}
            <Svg width={size} height={size}>
                <Defs>
                    <LinearGradient id="vdc-ring" x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0" stopColor={RING_COLORS[0]} />
                        <Stop offset="1" stopColor={RING_COLORS[1]} />
                    </LinearGradient>
                </Defs>
                {showsTrack && (
                    <Circle
                        cx={center}
                        cy={center}
                        r={radius}
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth={stroke}
                        fill="transparent"
                    />
                )}
                {showsArc && (
                    <AnimatedCircle
                        cx={center}
                        cy={center}
                        r={radius}
                        stroke="url(#vdc-ring)"
                        strokeWidth={stroke}
                        fill="transparent"
                        strokeLinecap="round"
                        strokeDasharray={`${circumference} ${circumference}`}
                        animatedProps={arcProps}
                    />
                )}
                {state === 'downloading' && (
                    <AnimatedCircle
                        r={stroke * 0.9}
                        fill={RING_COLORS[0]}
                        opacity={0.9}
                        animatedProps={headAngle}
                    />
                )}
            </Svg>
        </View>
    );
}

// ── icons ───────────────────────────────────────────────────────────────────

const CHECK_PATH = 'M -5.5 0.5 L -1.5 4.5 L 6 -4.5';

/** The icon for one state, cross-faded in (scale 0.8 → 1, opacity). */
function StateIcon({
    state,
    entered,
    reduceMotion,
}: {
    state: VideoDownloadState;
    /** false for the static popup copy: no entry animation. */
    entered: boolean;
    reduceMotion: boolean;
}): React.ReactElement {
    const opacity = useSharedValue(entered ? 1 : 0);
    const scale = useSharedValue(1);

    useEffect((): void => {
        if (!entered) {
            opacity.value = 1;
            scale.value = 1;
            return;
        }
        opacity.value = withTiming(1, {
            duration: reduceMotion ? 90 : 140,
            easing: Easing.linear,
        });
        scale.value = reduceMotion
            ? 1
            : withSpring(1, { damping: 16, stiffness: 260, mass: 0.4 });
    }, [entered, reduceMotion, opacity, scale]);

    const style = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    return (
        <Animated.View style={[styles.iconWrap, style]}>
            {state === 'idle' && (
                <ArrowDown
                    size={20}
                    color={palette.text.onAccent}
                    strokeWidth={2.4}
                />
            )}
            {state === 'queued' && <View style={styles.queuedDot} />}
            {state === 'downloading' && (
                <X size={18} color={palette.text.onAccent} strokeWidth={2.6} />
            )}
            {state === 'paused' && (
                <Play
                    size={19}
                    color={palette.text.onAccent}
                    strokeWidth={2.4}
                    fill={palette.text.onAccent}
                />
            )}
            {state === 'verifying' && (
                <ActivityIndicator size="small" color={palette.text.onAccent} />
            )}
            {state === 'error' && (
                <RotateCw
                    size={18}
                    color={palette.semantic.danger}
                    strokeWidth={2.4}
                />
            )}
            {state === 'ready' && (
                <ReadyIcon entered={entered} reduceMotion={reduceMotion} />
            )}
        </Animated.View>
    );
}

/**
 * Ready icon: a checkmark draws itself (~300 ms) with a scale pop, then
 * cross-fades into the play icon. A video that is already ready on mount
 * (popup copy, or the bubble after a restart) shows just the play icon.
 */
function ReadyIcon({
    entered,
    reduceMotion,
}: {
    entered: boolean;
    reduceMotion: boolean;
}): React.ReactElement {
    // `phase`: 0 = hidden, 1 = check drawing, 2 = play.
    const phase = useRef<'check' | 'play'>('play');
    const checkOpacity = useSharedValue(0);
    const checkDraw = useSharedValue(1);
    const checkScale = useSharedValue(1);
    const playOpacity = useSharedValue(1);

    useEffect((): void => {
        if (!entered || reduceMotion) {
            phase.current = 'play';
            playOpacity.value = 1;
            checkOpacity.value = 0;
            return;
        }
        phase.current = 'check';
        checkDraw.value = 0;
        checkOpacity.value = 1;
        playOpacity.value = 0;
        checkScale.value = withSequence(
            withTiming(1.15, {
                duration: 120,
                easing: Easing.out(Easing.quad),
            }),
            withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) }),
        );
        checkDraw.value = withTiming(1, {
            duration: 300,
            easing: Easing.out(Easing.quad),
        });
        playOpacity.value = withDelay(
            550,
            withTiming(1, { duration: 200, easing: Easing.linear }),
        );
        checkOpacity.value = withDelay(
            550,
            withTiming(0, { duration: 200, easing: Easing.linear }),
        );
    }, [
        entered,
        reduceMotion,
        checkOpacity,
        checkDraw,
        checkScale,
        playOpacity,
    ]);

    const checkProps = useAnimatedProps(() => ({
        strokeDashoffset: 22 * (1 - checkDraw.value),
    }));
    const checkStyle = useAnimatedStyle(() => ({
        opacity: checkOpacity.value,
        transform: [{ scale: checkScale.value }],
    }));
    const playStyle = useAnimatedStyle(() => ({
        opacity: playOpacity.value,
    }));

    return (
        <View style={styles.readyWrap}>
            <Animated.View
                style={[styles.readyLayer, checkStyle]}
                pointerEvents="none"
            >
                <Svg width={26} height={26} pointerEvents="none">
                    <AnimatedPath
                        d={CHECK_PATH}
                        translateX={13}
                        translateY={13}
                        stroke={palette.semantic.success}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="transparent"
                        strokeDasharray="22 22"
                        animatedProps={checkProps}
                    />
                </Svg>
            </Animated.View>
            <Animated.View
                style={[styles.readyLayer, playStyle]}
                pointerEvents="none"
            >
                <Play
                    size={22}
                    color={palette.text.onAccent}
                    strokeWidth={2.4}
                    fill={palette.text.onAccent}
                />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overlayViewer: {},
    pressable: { alignItems: 'center', justifyContent: 'center' },
    circle: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: GLASS_FILL,
        borderWidth: 1,
        borderColor: GLASS_BORDER,
        overflow: 'hidden',
        shadowColor: palette.primary[500],
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
        elevation: 6,
    },
    circleError: {
        borderColor: 'rgba(255,122,138,0.45)',
        shadowColor: palette.semantic.danger,
    },
    circleGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '60%',
    },
    ring: { position: 'absolute', top: 0, left: 0 },
    ringWrap: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconWrap: { alignItems: 'center', justifyContent: 'center' },
    queuedDot: {
        width: 6,
        height: 6,
        borderRadius: radii.full,
        backgroundColor: 'rgba(255,255,255,0.7)',
    },
    readyWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
    },
    readyLayer: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
