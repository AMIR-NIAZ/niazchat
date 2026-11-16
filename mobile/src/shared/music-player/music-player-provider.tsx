import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFrameCallback } from 'react-native-reanimated';
import { initAudioDownloader } from '../media-cache';
import { musicClockPosition } from './music-clock';
import { MiniPlayerBar } from './mini-player-bar';
import { FullPlayerSheet } from './full-player-sheet';
import { useAuthStore } from '../../features/auth/auth-store';
import {
    musicBasePosition,
    musicBaseTimestamp,
    musicDuration,
    musicIsPlaying,
    musicIsScrubbing,
    musicPosition,
    musicRateShared,
    restoreMusicOrder,
    useMusicBarVisible,
    useMusicPlaybackStatus,
} from './player-store';

/**
 * Mounts the single global music player UI above the navigator:
 *
 *   zIndex 800  mini player bar (paints above every screen, but only on the
 *               screens that registered an anchor via `useMiniPlayerAnchor`)
 *   zIndex 850  full player sheet (covers the bar)
 *
 * The bar layer is always mounted; hiding it on other screens never stops
 * playback. Media viewer (900) and popups/dialogs (1000/1100) stay above both.
 *
 * It also owns THE frame clock: one shared `useFrameCallback` derives the
 * live position from `basePosition + elapsed × rate` on the UI thread. It
 * runs only while a track is actually playing — pause, buffering and scrubs
 * stop it, and the frozen `musicPosition` stays exactly where it was.
 */
export function MusicPlayerProvider({
    children,
}: {
    children: React.ReactNode;
}): React.ReactElement {
    const visible = useMusicBarVisible();
    const playing = useMusicPlaybackStatus() === 'playing';
    const userId = useAuthStore((state) => state.userId);
    const [expanded, setExpanded] = useState(false);

    const frame = useFrameCallback((): void => {
        'worklet';
        if (!musicIsPlaying.value || musicIsScrubbing.value) return;
        const duration = musicDuration.value;
        const now = performance.now();
        const next = musicClockPosition(
            musicBasePosition.value,
            musicBaseTimestamp.value,
            musicIsPlaying.value,
            musicRateShared.value,
            duration,
            now,
        );
        musicPosition.value = next;
        // End of the track: stop the clock until `ended` arrives. Never
        // auto-advance from the clock alone.
        if (duration > 0 && next >= duration) {
            musicBasePosition.value = duration;
            musicBaseTimestamp.value = now;
            musicIsPlaying.value = false;
        }
    }, false);

    // The UI-thread clock is only needed while audio flows. React leaves this
    // effect disabled for pause/buffering/loading.
    useEffect((): void => {
        frame.setActive(visible && playing);
    }, [frame, playing, visible]);

    // The bar disappeared (stop / queue ended): never leave a floating sheet.
    useEffect((): void => {
        if (!visible) setExpanded(false);
    }, [visible]);

    // Adopt downloaded tracks from the cache index on app start.
    useEffect((): void => {
        void initAudioDownloader().catch((): void => undefined);
    }, []);

    // Restore this user's saved play order at app start (and after a login).
    useEffect((): void => {
        if (userId !== null) void restoreMusicOrder(userId);
    }, [userId]);

    return (
        <>
            {children}
            <View style={styles.overlay} pointerEvents="box-none">
                <MiniPlayerBar
                    visible={visible}
                    expanded={expanded}
                    onExpand={(): void => setExpanded(true)}
                />
                <FullPlayerSheet
                    visible={visible && expanded}
                    onClose={(): void => setExpanded(false)}
                />
            </View>
        </>
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
    overlay: {
        ...FILL,
        zIndex: 800,
    },
});
