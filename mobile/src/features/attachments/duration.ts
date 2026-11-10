/**
 * Pure duration helpers shared by audio/video UI and the preview labels.
 * Kept free of React Native imports so the plain-TS tests can run in Node.
 */

/** Only finite, positive metadata may render as a duration badge. */
export function hasDuration(value: number | undefined | null): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** 0:07 / 1:42 / 1:02:03. */
export function formatDuration(seconds: number): string {
    const total = Number.isFinite(seconds)
        ? Math.max(0, Math.round(seconds))
        : 0;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (value: number): string => String(value).padStart(2, '0');
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(secs)}`
        : `${minutes}:${pad(secs)}`;
}

/** "🎤 Voice message 0:23" (no time when the server sent no duration). */
export function voicePreviewLabel(durationSeconds?: number | null): string {
    return hasDuration(durationSeconds)
        ? `🎤 Voice message ${formatDuration(durationSeconds)}`
        : '🎤 Voice message';
}
