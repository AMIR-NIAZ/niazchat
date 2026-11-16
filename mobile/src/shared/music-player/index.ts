export { MusicPlayerProvider } from './music-player-provider';
export { MiniPlayerBar, MINI_PLAYER_BAR_HEIGHT } from './mini-player-bar';
export { FullPlayerSheet } from './full-player-sheet';
export {
    useMusicPlayer,
    useMusicBarVisible,
    useMusicActiveTrackId,
    useIsActiveTrack,
    usePlayerStatus,
    useMusicPlaybackStatus,
    useMusicDuration,
    useMusicTrack,
    useMusicRate,
    useMusicOrder,
    getMusicPlayerState,
} from './player-store';
export type {
    MusicPlayerState,
    MusicTrack,
    MusicPlaybackStatus,
    MusicRate,
} from './player-store';
export {
    MUSIC_RATES,
    MUSIC_RESTART_THRESHOLD_SECONDS,
    playMusicTrack,
    toggleMusicTrack,
    pauseMusic,
    resumeMusic,
    toggleMusic,
    nextMusic,
    previousMusic,
    seekMusic,
    stopMusic,
    setMusicRate,
    setMusicOrder,
    cycleMusicOrder,
    restoreMusicOrder,
    syncMusicQueue,
} from './player-store';
export { MUSIC_PLAY_ORDERS } from './music-queue';
export type { MusicPlayOrder } from './music-queue';
export {
    goToMusicMessage,
    registerMusicJumpHandler,
    consumeMusicJumpRequest,
} from './music-navigation';
export { MusicTimeLabel } from './music-time-label';
export {
    musicBasePosition,
    musicBaseTimestamp,
    musicDuration,
    musicIsPlaying,
    musicIsScrubbing,
    musicPosition,
    musicRateShared,
    setMusicScrubbing,
} from './player-store';
export { MusicScrubLine } from './music-scrub-line';
export {
    MUSIC_BAR_HEIGHT,
    MUSIC_BAR_GAP,
    MUSIC_BAR_LIFT,
} from './music-bar-chrome';
export {
    miniPlayerAnchorTop,
    useMiniPlayerAnchor,
    useMiniPlayerEligible,
    useMusicBarShown,
} from './music-bar-anchor';
