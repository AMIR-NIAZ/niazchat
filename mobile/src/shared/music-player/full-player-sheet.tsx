import { useEffect, useState } from 'react';
import {
    BackHandler,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
    type LayoutChangeEvent,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
    ChevronDown,
    Music2,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    SkipBack,
    SkipForward,
} from 'lucide-react-native';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { palette, radii, spacing, typography } from '../theme';
import { goToMusicMessage } from './music-navigation';
import {
    MUSIC_RATES,
    musicBasePosition,
    musicBaseTimestamp,
    musicDuration,
    musicIsScrubbing,
    musicPosition,
    nextMusic,
    previousMusic,
    seekMusic,
    setMusicOrder,
    setMusicRate,
    toggleMusic,
    useMusicPlayer,
} from './player-store';
import { MUSIC_PLAY_ORDERS, type MusicPlayOrder } from './music-queue';
import {
    MUSIC_ORDER_DESCRIPTIONS,
    MUSIC_ORDER_LABELS,
    MusicOrderGlyph,
} from './music-order-glyph';
import { formatMusicClock } from './music-clock';
import { MusicTimeLabel } from './music-time-label';

const SHEET_Z_INDEX = 850;
const COVER_SIZE = 280;

function haptic(): void {
    try {
        void Haptics.selectionAsync().catch((): void => undefined);
    } catch {
        // Decorative only.
    }
}

/**
 * Compact three-state play-order selector: the active segment is highlighted
 * in purple and a sliding indicator follows the choice (instant when the OS
 * asks for reduced motion). Changing it never interrupts the current track.
 */
function OrderSelector({
    order,
    reduceMotion,
}: {
    order: MusicPlayOrder;
    reduceMotion: boolean;
}): React.ReactElement {
    const [width, setWidth] = useState(0);
    const active = MUSIC_PLAY_ORDERS.indexOf(order);
    const position = useSharedValue(active);

    useEffect((): void => {
        position.value = reduceMotion
            ? active
            : withTiming(active, { duration: 180 });
    }, [active, position, reduceMotion]);

    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: position.value * (width / 3) }],
        opacity: width > 0 ? 1 : 0,
    }));

    return (
        <View style={styles.orderRow}>
            <View
                style={styles.orderControl}
                onLayout={(event: LayoutChangeEvent): void =>
                    setWidth(event.nativeEvent.layout.width)
                }
                accessibilityRole="radiogroup"
                accessibilityLabel="Play order"
            >
                <Animated.View
                    style={[
                        styles.orderIndicator,
                        width > 0 ? { width: width / 3 } : null,
                        indicatorStyle,
                    ]}
                    pointerEvents="none"
                />
                {MUSIC_PLAY_ORDERS.map((mode) => (
                    <Pressable
                        key={mode}
                        accessibilityRole="radio"
                        accessibilityLabel={`${MUSIC_ORDER_LABELS[mode]} — ${MUSIC_ORDER_DESCRIPTIONS[mode]}`}
                        accessibilityState={{ selected: order === mode }}
                        onPress={(): void => {
                            haptic();
                            setMusicOrder(mode);
                        }}
                        style={styles.orderSegment}
                    >
                        <MusicOrderGlyph
                            order={mode}
                            size={18}
                            color={
                                order === mode
                                    ? palette.text.onAccent
                                    : palette.text.secondary
                            }
                        />
                    </Pressable>
                ))}
            </View>
            <Text style={styles.orderLabel}>{MUSIC_ORDER_LABELS[order]}</Text>
        </View>
    );
}

export function FullPlayerSheet({
    visible,
    onClose,
}: {
    visible: boolean;
    onClose: () => void;
}): React.ReactElement | null {
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const reduceMotion = useReducedMotion();
    const player = useMusicPlayer();
    const [mounted, setMounted] = useState(visible);
    const shown = useSharedValue(0);
    const dragY = useSharedValue(0);
    const barWidth = useSharedValue(0);

    const duration = player.duration;
    const track = player.track;

    useEffect((): void => {
        if (visible) {
            setMounted(true);
            dragY.value = 0;
            shown.value = reduceMotion
                ? 1
                : withSpring(1, { damping: 22, stiffness: 210, mass: 0.8 });
            return;
        }
        if (!mounted) return;
        shown.value = reduceMotion
            ? 0
            : withTiming(0, { duration: 180 }, (finished): void => {
                  if (finished) scheduleOnRN(setMounted, false);
              });
    }, [dragY, mounted, reduceMotion, shown, visible]);

    // Android back closes the sheet before the screen underneath.
    useEffect((): (() => void) | undefined => {
        if (!visible) return undefined;
        const subscription = BackHandler.addEventListener(
            'hardwareBackPress',
            (): boolean => {
                onClose();
                return true;
            },
        );
        return (): void => subscription.remove();
    }, [onClose, visible]);

    const containerStyle = useAnimatedStyle(() => ({
        opacity: shown.value,
    }));
    const sheetStyle = useAnimatedStyle(() => ({
        transform: [
            {
                translateY:
                    (1 - shown.value) * height + Math.max(0, dragY.value),
            },
        ],
    }));

    const drag = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .onUpdate((event): void => {
            dragY.value = Math.max(0, event.translationY);
        })
        .onEnd((event): void => {
            if (event.translationY > 120 || event.velocityY > 900) {
                scheduleOnRN(onClose);
                return;
            }
            dragY.value = withSpring(0, { damping: 20, stiffness: 200 });
        });

    const progressStyle = useAnimatedStyle(() => {
        const ratio = Math.max(
            0.0001,
            Math.min(
                1,
                musicPosition.value / Math.max(0.0001, musicDuration.value),
            ),
        );
        return { transform: [{ scaleX: ratio }] };
    });
    const thumbStyle = useAnimatedStyle(() => {
        const ratio = Math.min(
            1,
            musicPosition.value / Math.max(0.0001, musicDuration.value),
        );
        return {
            transform: [{ translateX: ratio * barWidth.value - 6 }],
            opacity: barWidth.value > 0 ? 1 : 0,
        };
    });

    const onBarLayout = (event: LayoutChangeEvent): void => {
        barWidth.value = event.nativeEvent.layout.width;
    };

    // The gesture owns `musicPosition` while it drags (the clock holds still),
    // then re-bases exactly at the release point so playback resumes without a
    // single frame of jump.
    const barGesture = Gesture.Pan()
        .minDistance(0)
        .onBegin((event): void => {
            'worklet';
            if (barWidth.value <= 0 || musicDuration.value <= 0) return;
            musicIsScrubbing.value = true;
            musicPosition.value =
                (event.x / barWidth.value) * musicDuration.value;
        })
        .onUpdate((event): void => {
            'worklet';
            if (barWidth.value <= 0 || musicDuration.value <= 0) return;
            musicPosition.value = Math.max(
                0,
                Math.min(
                    musicDuration.value,
                    (event.x / barWidth.value) * musicDuration.value,
                ),
            );
        })
        .onEnd((): void => {
            'worklet';
            const target = musicPosition.value;
            musicIsScrubbing.value = false;
            musicBasePosition.value = target;
            musicBaseTimestamp.value = performance.now();
            scheduleOnRN(seekMusic, target);
        })
        .onFinalize((): void => {
            'worklet';
            musicIsScrubbing.value = false;
        });

    if (!mounted || track === null) return null;

    const playing = player.status === 'playing';
    const artist = track.artist ?? 'Unknown artist';
    const queueLabel =
        player.index >= 0 && player.queue.length > 0
            ? `${player.index + 1} of ${player.queue.length}`
            : null;

    const skip = (delta: number): void => {
        haptic();
        void seekMusic(musicPosition.value + delta);
    };

    const cycleRate = (): void => {
        const index = MUSIC_RATES.indexOf(player.rate);
        const next = MUSIC_RATES[(index + 1) % MUSIC_RATES.length] ?? 1;
        setMusicRate(next);
        haptic();
    };

    return (
        <Animated.View
            style={[styles.layer, containerStyle]}
            pointerEvents="box-none"
        >
            <View style={styles.backdrop} pointerEvents="none">
                {track.coverUrl !== null ? (
                    <Image
                        source={{ uri: track.coverUrl }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        blurRadius={40}
                    />
                ) : (
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: palette.primary[100] },
                        ]}
                    />
                )}
                <View style={styles.backdropShade} />
            </View>

            <GestureDetector gesture={drag}>
                <Animated.View
                    style={[
                        styles.sheet,
                        { paddingBottom: insets.bottom + spacing.lg },
                        sheetStyle,
                    ]}
                >
                    <View style={styles.handle} />

                    <View style={styles.topRow}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Close player"
                            onPress={onClose}
                            style={styles.closeButton}
                            hitSlop={8}
                        >
                            <ChevronDown
                                size={24}
                                color={palette.text.primary}
                                strokeWidth={2.2}
                            />
                        </Pressable>
                        <Text style={styles.queueLabel} numberOfLines={1}>
                            {queueLabel === null ? 'Now playing' : queueLabel}
                        </Text>
                        <View style={styles.closeButton} />
                    </View>

                    <View style={styles.coverWrap}>
                        {track.coverUrl !== null ? (
                            <Image
                                source={{ uri: track.coverUrl }}
                                style={styles.cover}
                                contentFit="cover"
                                transition={150}
                            />
                        ) : (
                            <View style={[styles.cover, styles.coverFallback]}>
                                <Music2
                                    size={96}
                                    color={palette.text.onAccent}
                                    strokeWidth={1.4}
                                />
                            </View>
                        )}
                    </View>

                    <View style={styles.titleBlock}>
                        <Text style={styles.title} numberOfLines={1}>
                            {track.title}
                        </Text>
                        <Text style={styles.artist} numberOfLines={1}>
                            {artist}
                        </Text>
                    </View>

                    <GestureDetector gesture={barGesture}>
                        <View
                            style={styles.seekArea}
                            onLayout={onBarLayout}
                            accessibilityRole="adjustable"
                            accessibilityLabel="Seek"
                            accessibilityValue={{
                                min: 0,
                                max: Math.round(duration),
                            }}
                        >
                            <View style={styles.track}>
                                <Animated.View
                                    style={[styles.trackFill, progressStyle]}
                                />
                            </View>
                            <Animated.View
                                style={[styles.thumb, thumbStyle]}
                                pointerEvents="none"
                            />
                            <View style={styles.timeRow}>
                                <MusicTimeLabel style={styles.time} />
                                <Text style={styles.time}>
                                    {formatMusicClock(duration)}
                                </Text>
                            </View>
                        </View>
                    </GestureDetector>

                    <View style={styles.controls}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Previous track"
                            onPress={(): void => {
                                haptic();
                                previousMusic();
                            }}
                            style={styles.sideButton}
                        >
                            <SkipBack
                                size={28}
                                color={palette.text.primary}
                                strokeWidth={2}
                            />
                        </Pressable>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Back 10 seconds"
                            onPress={(): void => skip(-10)}
                            style={styles.skipButton}
                        >
                            <RotateCcw
                                size={22}
                                color={palette.text.primary}
                                strokeWidth={2}
                            />
                            <Text style={styles.skipLabel}>10</Text>
                        </Pressable>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${track.title}`}
                            onPress={(): void => {
                                haptic();
                                toggleMusic();
                            }}
                            style={styles.playButton}
                        >
                            {playing ? (
                                <Pause
                                    size={32}
                                    color={palette.text.onAccent}
                                    strokeWidth={2.2}
                                    fill={palette.text.onAccent}
                                />
                            ) : (
                                <Play
                                    size={32}
                                    color={palette.text.onAccent}
                                    strokeWidth={2.2}
                                    fill={palette.text.onAccent}
                                />
                            )}
                        </Pressable>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Forward 10 seconds"
                            onPress={(): void => skip(10)}
                            style={styles.skipButton}
                        >
                            <RotateCw
                                size={22}
                                color={palette.text.primary}
                                strokeWidth={2}
                            />
                            <Text style={styles.skipLabel}>10</Text>
                        </Pressable>

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Next track"
                            onPress={(): void => {
                                haptic();
                                nextMusic();
                            }}
                            style={styles.sideButton}
                        >
                            <SkipForward
                                size={28}
                                color={palette.text.primary}
                                strokeWidth={2}
                            />
                        </Pressable>
                    </View>

                    <OrderSelector
                        order={player.order}
                        reduceMotion={reduceMotion}
                    />

                    <View style={styles.footer}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Playback speed ${player.rate}x`}
                            onPress={cycleRate}
                            style={styles.chip}
                        >
                            <Text style={styles.chipText}>
                                {`${player.rate}x`}
                            </Text>
                        </Pressable>

                        {track.chatId !== null ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Go to message"
                                onPress={(): void => {
                                    onClose();
                                    goToMusicMessage(
                                        track.chatId as number,
                                        track.messageKey,
                                    );
                                }}
                                style={styles.chip}
                            >
                                <Text style={styles.chipText}>
                                    Go to message
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                </Animated.View>
            </GestureDetector>
        </Animated.View>
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
    layer: {
        ...FILL,
        zIndex: SHEET_Z_INDEX,
    },
    backdrop: { ...FILL },
    backdropShade: {
        ...FILL,
        backgroundColor: 'rgba(10,12,16,0.82)',
    },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: '86%',
        backgroundColor: 'rgba(18,20,24,0.92)',
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.xs,
        overflow: 'hidden',
    },
    handle: {
        alignSelf: 'center',
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.28)',
        marginBottom: spacing.sm,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
    },
    closeButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    queueLabel: {
        ...typography.caption,
        color: palette.text.secondary,
        letterSpacing: 0.4,
    },
    coverWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.sm,
    },
    cover: {
        width: COVER_SIZE,
        height: COVER_SIZE,
        borderRadius: radii.xl,
        backgroundColor: palette.primary[700],
    },
    coverFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[600],
    },
    titleBlock: {
        alignItems: 'center',
        gap: 2,
        paddingVertical: spacing.sm,
    },
    title: {
        ...typography.heading,
        color: palette.text.onAccent,
        fontSize: 20,
        textAlign: 'center',
    },
    artist: {
        ...typography.caption,
        color: palette.text.secondary,
        fontSize: 13,
        textAlign: 'center',
    },
    seekArea: {
        height: 62,
        justifyContent: 'center',
        paddingTop: spacing.xs,
    },
    track: {
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.18)',
        overflow: 'hidden',
    },
    trackFill: {
        ...FILL,
        backgroundColor: palette.primary[300],
        transformOrigin: 'left',
    },
    thumb: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: palette.text.onAccent,
        marginTop: -8,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: spacing.xxs,
    },
    time: {
        color: palette.text.secondary,
        fontSize: 11,
        fontVariant: ['tabular-nums'],
    },
    orderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingTop: spacing.sm,
    },
    orderControl: {
        flexDirection: 'row',
        height: 44,
        borderRadius: radii.full,
        backgroundColor: 'rgba(255,255,255,0.10)',
        overflow: 'hidden',
    },
    orderIndicator: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        borderRadius: radii.full,
        backgroundColor: palette.primary[500],
    },
    orderSegment: {
        width: 56,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    orderLabel: {
        ...typography.caption,
        color: palette.text.secondary,
        fontSize: 11,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
    },
    sideButton: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    skipButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    skipLabel: {
        position: 'absolute',
        color: palette.text.primary,
        fontSize: 8,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    playButton: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[600],
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingTop: spacing.sm,
    },
    chip: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.full,
        backgroundColor: 'rgba(255,255,255,0.12)',
        minHeight: 36,
        justifyContent: 'center',
    },
    chipText: {
        color: palette.text.onAccent,
        fontSize: 13,
        fontWeight: '600',
    },
});
