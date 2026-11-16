import { useEffect, useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    View,
    type LayoutChangeEvent,
} from 'react-native';
import Animated, {
    Easing,
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Music2, Pause, Play, X } from 'lucide-react-native';
import { GlassSurface } from '../components';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { palette, radii, spacing } from '../theme';
import {
    cycleMusicOrder,
    nextMusic,
    previousMusic,
    stopMusic,
    toggleMusic,
    useMusicOrder,
    useMusicPlaybackStatus,
    useMusicTrack,
} from './player-store';
import { MUSIC_ORDER_LABELS, MusicOrderGlyph } from './music-order-glyph';
import { MusicTimeLabel } from './music-time-label';
import { MusicScrubLine } from './music-scrub-line';
import { MUSIC_BAR_HEIGHT, MUSIC_BAR_GAP } from './music-bar-chrome';
import { miniPlayerAnchorTop, useMiniPlayerEligible } from './music-bar-anchor';

const BAR_HEIGHT = MUSIC_BAR_HEIGHT;
const BAR_MARGIN = 12;
const COVER_SIZE = 32;
const IN_MS = 260;
const OUT_MS = 160;

function haptic(action: 'light' | 'medium'): void {
    try {
        void Haptics.impactAsync(
            action === 'light'
                ? Haptics.ImpactFeedbackStyle.Light
                : Haptics.ImpactFeedbackStyle.Medium,
        ).catch((): void => undefined);
    } catch {
        // Haptics are decorative: a device without them must not break playback.
    }
}

/** One-line title that scrolls only when it overflows (marquee). */
function MarqueeText({
    text,
    style,
    active,
    reduceMotion,
}: {
    text: string;
    style: object;
    active: boolean;
    reduceMotion: boolean;
}): React.ReactElement {
    const [containerWidth, setContainerWidth] = useState(0);
    const [textWidth, setTextWidth] = useState(0);
    const shift = useSharedValue(0);

    const overflow = Math.max(0, textWidth - containerWidth);

    useEffect((): void => {
        cancelAnimation(shift);
        if (reduceMotion || !active || overflow <= 0) {
            shift.value = withTiming(0, { duration: OUT_MS });
            return;
        }
        shift.value = 0;
        shift.value = withRepeat(
            withTiming(-overflow, {
                duration: Math.max(3000, overflow * 60),
                easing: Easing.linear,
            }),
            -1,
            true,
        );
    }, [active, overflow, reduceMotion, shift]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: shift.value }],
    }));

    return (
        <View
            style={styles.marqueeWindow}
            onLayout={(event: LayoutChangeEvent): void =>
                setContainerWidth(event.nativeEvent.layout.width)
            }
            pointerEvents="none"
        >
            <Animated.Text
                numberOfLines={1}
                style={[style, animatedStyle]}
                onLayout={(event: LayoutChangeEvent): void =>
                    setTextWidth(event.nativeEvent.layout.width)
                }
            >
                {text}
            </Animated.Text>
        </View>
    );
}

function Cover({
    coverUrl,
    playing,
    reduceMotion,
}: {
    coverUrl: string | null;
    playing: boolean;
    reduceMotion: boolean;
}): React.ReactElement {
    const angle = useSharedValue(0);

    useEffect((): void => {
        if (reduceMotion) {
            angle.value = 0;
            return;
        }
        if (playing) {
            angle.value = withRepeat(
                withTiming(360, {
                    duration: 8000,
                    easing: Easing.linear,
                }),
                -1,
                false,
            );
            return;
        }
        cancelAnimation(angle);
    }, [angle, playing, reduceMotion]);

    const spin = useAnimatedStyle(() => ({
        transform: [{ rotate: `${angle.value}deg` }],
    }));

    return (
        <Animated.View style={[styles.cover, spin]}>
            {coverUrl !== null ? (
                <Image
                    source={{ uri: coverUrl }}
                    style={styles.coverImage}
                    contentFit="cover"
                    transition={120}
                />
            ) : (
                <View style={styles.coverFallback}>
                    <Music2
                        size={16}
                        color={palette.text.onAccent}
                        strokeWidth={2}
                    />
                </View>
            )}
            <View style={styles.coverHole} />
        </Animated.View>
    );
}

export function MiniPlayerBar({
    visible,
    expanded,
    onExpand,
}: {
    visible: boolean;
    expanded: boolean;
    onExpand: () => void;
}): React.ReactElement | null {
    const reduceMotion = useReducedMotion();
    const track = useMusicTrack();
    const status = useMusicPlaybackStatus();
    const order = useMusicOrder();
    // Eligible screens (chat list, chat) own the bar's top edge; everywhere
    // else there is no anchor and the bar is hidden while playback continues.
    const eligible = useMiniPlayerEligible();
    const shownNow = visible && eligible;
    const [mounted, setMounted] = useState(shownNow);
    const shown = useSharedValue(0);

    useEffect((): void => {
        if (shownNow) {
            setMounted(true);
            shown.value = reduceMotion
                ? 1
                : withTiming(1, {
                      duration: IN_MS,
                      easing: Easing.out(Easing.cubic),
                  });
            return;
        }
        if (!mounted) return;
        shown.value = reduceMotion
            ? 0
            : withTiming(
                  0,
                  { duration: OUT_MS, easing: Easing.in(Easing.cubic) },
                  (finished): void => {
                      if (finished) scheduleOnRN(setMounted, false);
                  },
              );
    }, [mounted, reduceMotion, shown, shownNow]);

    const animated = useAnimatedStyle(() => ({
        opacity: shown.value,
        // The registry publishes the only valid top edge (measured header +
        // gap) and glides it between eligible screens: no guessing here.
        top: miniPlayerAnchorTop.value,
        transform: [{ translateY: (1 - shown.value) * -16 }],
    }));

    // Swipe next/previous on the bar BODY only; the bottom scrub strip is a
    // separate gesture area (it sits on top, so it wins when touched).
    const pan = Gesture.Pan()
        .activeOffsetX([-18, 18])
        .failOffsetY([-12, 12])
        .onEnd((event): void => {
            'worklet';
            if (event.translationX < -56) {
                scheduleOnRN(haptic, 'light');
                scheduleOnRN(nextMusic);
                return;
            }
            if (event.translationX > 56) {
                scheduleOnRN(haptic, 'light');
                scheduleOnRN(previousMusic);
                return;
            }
            if (event.translationY < -40) {
                scheduleOnRN(haptic, 'medium');
                scheduleOnRN(stopMusic);
            }
        });

    if (!mounted || track === null || expanded) return null;

    const playing = status === 'playing';
    const loading = status === 'loading';
    const artist = track.artist ?? 'Unknown artist';

    return (
        <Animated.View
            style={[styles.layer, animated]}
            pointerEvents="box-none"
        >
            <GestureDetector gesture={pan}>
                <GlassSurface
                    tone="elevated"
                    radius={BAR_HEIGHT / 2}
                    floating
                    intensity={60}
                    style={styles.pill}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open player, ${track.title}`}
                        onPress={onExpand}
                        style={styles.coverButton}
                    >
                        <Cover
                            coverUrl={track.coverUrl}
                            playing={playing}
                            reduceMotion={reduceMotion}
                        />
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open player, ${track.title}, ${artist}`}
                        onPress={onExpand}
                        style={styles.meta}
                    >
                        <MarqueeText
                            text={track.title}
                            style={styles.title}
                            active={playing}
                            reduceMotion={reduceMotion}
                        />
                        {loading ? (
                            <Text style={styles.artist} numberOfLines={1}>
                                Loading…
                            </Text>
                        ) : (
                            <MarqueeText
                                text={artist}
                                style={styles.artist}
                                active={playing}
                                reduceMotion={reduceMotion}
                            />
                        )}
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Play order: ${MUSIC_ORDER_LABELS[order]}. Change play order`}
                        onPress={(): void => {
                            haptic('light');
                            cycleMusicOrder();
                        }}
                        hitSlop={8}
                        style={styles.orderButton}
                    >
                        <MusicOrderGlyph
                            order={order}
                            size={15}
                            color={palette.text.secondary}
                        />
                    </Pressable>

                    {loading ? null : (
                        <MusicTimeLabel style={styles.time} showTotal />
                    )}

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${track.title}`}
                        accessibilityState={{ busy: loading }}
                        onPress={(): void => {
                            haptic('light');
                            toggleMusic();
                        }}
                        hitSlop={4}
                        style={styles.iconButton}
                    >
                        {playing ? (
                            <Pause
                                size={20}
                                color={palette.text.primary}
                                strokeWidth={2.2}
                                fill={palette.text.primary}
                            />
                        ) : (
                            <Play
                                size={20}
                                color={palette.text.primary}
                                strokeWidth={2.2}
                                fill={palette.text.primary}
                            />
                        )}
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close player"
                        onPress={(): void => {
                            haptic('medium');
                            stopMusic();
                        }}
                        hitSlop={4}
                        style={styles.iconButton}
                    >
                        <X
                            size={20}
                            color={palette.text.secondary}
                            strokeWidth={2.2}
                        />
                    </Pressable>

                    <MusicScrubLine
                        touchHeight={MUSIC_BAR_GAP + 18}
                        mine={false}
                    />
                </GlassSurface>
            </GestureDetector>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    layer: {
        position: 'absolute',
        left: BAR_MARGIN,
        right: BAR_MARGIN,
        zIndex: 800,
    },
    pill: {
        height: BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 6,
        paddingRight: 2,
        gap: spacing.xs,
        overflow: 'hidden',
    },
    coverButton: {
        width: COVER_SIZE,
        height: COVER_SIZE,
        borderRadius: COVER_SIZE / 2,
        overflow: 'hidden',
    },
    cover: {
        width: COVER_SIZE,
        height: COVER_SIZE,
        borderRadius: COVER_SIZE / 2,
        backgroundColor: palette.primary[600],
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    coverImage: { width: '100%', height: '100%' },
    coverFallback: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[600],
    },
    coverHole: {
        position: 'absolute',
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: palette.glass.elevated,
    },
    meta: { flex: 1, minWidth: 0, justifyContent: 'center' },
    marqueeWindow: { overflow: 'hidden' },
    title: {
        color: palette.text.primary,
        fontSize: 13,
        fontWeight: '600',
    },
    artist: {
        color: palette.text.secondary,
        fontSize: 11,
        marginTop: 1,
    },
    orderButton: {
        width: 28,
        height: 28,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    time: {
        color: palette.text.secondary,
        fontSize: 10,
        fontVariant: ['tabular-nums'],
    },
    iconButton: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export const MINI_PLAYER_BAR_HEIGHT = BAR_HEIGHT;
export { MUSIC_BAR_GAP };
