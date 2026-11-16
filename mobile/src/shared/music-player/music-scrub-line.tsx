import { StyleSheet, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { palette } from '../theme';
import {
    musicBasePosition,
    musicBaseTimestamp,
    musicDuration,
    musicIsScrubbing,
    musicPosition,
    seekMusic,
} from './player-store';

/**
 * A draggable/tappable scrub line for the ACTIVE track (mini bar bottom strip
 * and the music bubble). The visual line is 2 px; the touch strip is taller.
 *
 * The gesture writes the shared `musicPosition` directly on the UI thread, so
 * the fill tracks the finger even while the JS thread is busy (the frame clock
 * and status corrections hold still while `musicIsScrubbing`). On release the
 * clock is re-based at the release point and an async seek is issued.
 * Horizontal-only activation keeps vertical list scrolling flowing through.
 */
export function MusicScrubLine({
    touchHeight,
    mine = false,
}: {
    /** Height of the touch strip around the 2 px line. */
    touchHeight: number;
    mine?: boolean;
}): React.ReactElement {
    const width = useSharedValue(0);

    const fillStyle = useAnimatedStyle(() => ({
        transform: [
            {
                scaleX: Math.max(
                    0.0001,
                    Math.min(
                        1,
                        musicPosition.value /
                            Math.max(0.0001, musicDuration.value),
                    ),
                ),
            },
        ],
    }));
    const thumbStyle = useAnimatedStyle(() => {
        const ratio = Math.min(
            1,
            musicPosition.value / Math.max(0.0001, musicDuration.value),
        );
        return {
            opacity: musicIsScrubbing.value ? 1 : 0,
            transform: [{ translateX: ratio * width.value - 5 }],
        };
    });

    const scrub = Gesture.Pan()
        .activeOffsetX([-6, 6])
        .failOffsetY([-8, 8])
        .onBegin((event): void => {
            'worklet';
            if (width.value <= 0) return;
            musicIsScrubbing.value = true;
            musicPosition.value = (event.x / width.value) * musicDuration.value;
        })
        .onUpdate((event): void => {
            'worklet';
            if (width.value <= 0) return;
            musicPosition.value = Math.max(
                0,
                Math.min(
                    musicDuration.value,
                    (event.x / width.value) * musicDuration.value,
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

    const tap = Gesture.Tap().onStart((event): void => {
        'worklet';
        if (width.value <= 0) return;
        const target = (event.x / width.value) * musicDuration.value;
        // Snap the fill immediately, then perform the real seek (which
        // re-bases the clock on its own).
        musicPosition.value = target;
        scheduleOnRN(seekMusic, target);
    });

    return (
        <GestureDetector gesture={Gesture.Race(scrub, tap)}>
            <Animated.View
                style={[styles.strip, { height: touchHeight }]}
                onLayout={(event): void => {
                    width.value = event.nativeEvent.layout.width;
                }}
                accessibilityRole="adjustable"
                accessibilityLabel="Playback position"
            >
                <View
                    style={[
                        styles.line,
                        mine ? styles.lineMine : styles.lineTheirs,
                    ]}
                    pointerEvents="none"
                />
                <Animated.View
                    style={[
                        styles.fill,
                        mine ? styles.fillMine : styles.fillTheirs,
                        fillStyle,
                    ]}
                    pointerEvents="none"
                />
                <Animated.View
                    style={[styles.thumb, thumbStyle]}
                    pointerEvents="none"
                />
            </Animated.View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    strip: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'flex-end',
    },
    line: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
    },
    lineMine: { backgroundColor: 'rgba(255,255,255,0.28)' },
    lineTheirs: { backgroundColor: 'rgba(28,32,36,0.12)' },
    fill: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        transformOrigin: 'left',
    },
    fillMine: { backgroundColor: 'rgba(255,255,255,0.9)' },
    fillTheirs: { backgroundColor: palette.primary[500] },
    thumb: {
        position: 'absolute',
        bottom: -4,
        left: 0,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: palette.primary[500],
    },
});
