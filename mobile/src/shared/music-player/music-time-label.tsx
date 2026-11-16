import { memo, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { formatMusicClock } from './music-clock';
import { musicPosition, useMusicDuration } from './player-store';

/**
 * The "m:ss / m:ss" playback label.
 *
 * The position lives on the UI thread; this leaf is the ONLY React component
 * that subscribes to the clock, and only to its whole-second floor. It
 * re-renders at most once per second — never the list, the bubble row or the
 * player screen.
 */
export const MusicTimeLabel = memo(function MusicTimeLabel({
    style,
    totalSeconds,
    showTotal = false,
}: {
    style?: StyleProp<TextStyle> | undefined;
    /** Explicit total (e.g. attachment metadata); falls back to the player. */
    totalSeconds?: number | null | undefined;
    showTotal?: boolean | undefined;
}): React.ReactElement {
    const [seconds, setSeconds] = useState(0);
    const liveDuration = useMusicDuration();

    useAnimatedReaction(
        () => Math.floor(musicPosition.value),
        (next, previous): void => {
            if (next !== previous) scheduleOnRN(setSeconds, next);
        },
        [],
    );

    // The player's decoded duration wins; the attachment DTO is the fallback.
    const total =
        liveDuration > 0
            ? liveDuration
            : typeof totalSeconds === 'number' && totalSeconds > 0
              ? totalSeconds
              : 0;
    const text = showTotal
        ? `${formatMusicClock(seconds)} / ${formatMusicClock(total)}`
        : formatMusicClock(seconds);

    return (
        <Text style={style} numberOfLines={1}>
            {text}
        </Text>
    );
});
