/**
 * Sizing constants of the global mini player bar.
 *
 * WHERE the bar sits is not decided here: eligible screens publish their
 * measured header height through the anchor registry (`music-bar-anchor`), and
 * the bar positions itself at that anchor.
 */

/** Bar height + the gap under the floating header. */
export const MUSIC_BAR_HEIGHT = 44;
export const MUSIC_BAR_GAP = 6;
export const MUSIC_BAR_LIFT = MUSIC_BAR_HEIGHT + MUSIC_BAR_GAP;
