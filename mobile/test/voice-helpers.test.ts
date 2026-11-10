/**
 * Plain-TS unit tests for the voice helpers (no test framework in `mobile/`).
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' mobile/test/voice-helpers.test.ts
 */
import {
    meteringLevel,
    normalizePeaks,
    reachedRecordingLimit,
    recordingTimeLabel,
    shouldDiscardRecording,
} from '../src/features/voice/recording-machine';
import {
    nextSpeed,
    progressRatio,
    remainingSeconds,
    speedLabel,
} from '../src/features/voice/playback-model';
import {
    MAX_VOICE_CACHE_BYTES,
    MAX_VOICE_CACHE_FILES,
    selectVoiceEvictions,
} from '../src/features/voice/cache-policy';
import {
    formatDuration,
    voicePreviewLabel,
} from '../src/features/attachments/duration';
import { attachmentPreviewLabel } from '../src/features/attachments/attachment-labels';
import { uploadFailureReason } from '../src/features/attachments/attachment-upload';

let failures = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}`);
        console.error(error instanceof Error ? error.stack : error);
    }
}

function assertEqual<T>(actual: T, expected: T, label = ''): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

function assertTrue(value: boolean, label: string): void {
    if (!value) throw new Error(label);
}

test('metering maps dBFS to 0..1 and treats missing values as silence', () => {
    assertEqual(meteringLevel(-60), 0);
    assertEqual(meteringLevel(0), 1);
    assertEqual(meteringLevel(-30), 0.5);
    assertEqual(meteringLevel(null), 0);
    assertEqual(meteringLevel(Number.NaN), 0);
});

test('peaks normalize to exactly 64 bars in 0..100', () => {
    const bars = normalizePeaks([0, 0.25, 0.5, 1], 64);
    assertEqual(bars.length, 64);
    assertTrue(
        bars.every((bar) => Number.isInteger(bar) && bar >= 0 && bar <= 100),
        'bars must be integers 0..100',
    );
    assertEqual(bars[0], 0);
    assertEqual(bars[63], 100);
});

test('clips under one second are discarded; 10 minutes is the cap', () => {
    assertTrue(shouldDiscardRecording(0.9), '0.9 s discarded');
    assertTrue(shouldDiscardRecording(Number.NaN), 'NaN discarded');
    assertTrue(!shouldDiscardRecording(1), '1 s kept');
    assertTrue(!reachedRecordingLimit(10 * 60 * 1000 - 1), 'under cap');
    assertTrue(reachedRecordingLimit(10 * 60 * 1000), 'at cap');
});

test('recording label is m:ss', () => {
    assertEqual(recordingTimeLabel(0), '0:00');
    assertEqual(recordingTimeLabel(23_400), '0:23');
    assertEqual(recordingTimeLabel(610_000), '10:10');
});

test('speed cycles 1x -> 1.5x -> 2x -> 1x', () => {
    assertEqual(nextSpeed(1), 1.5);
    assertEqual(nextSpeed(1.5), 2);
    assertEqual(nextSpeed(2), 1);
    assertEqual(speedLabel(1.5), '1.5x');
});

test('progress and remaining time are safe for invalid values', () => {
    assertEqual(progressRatio(5, 10), 0.5);
    assertEqual(progressRatio(20, 10), 1);
    assertEqual(progressRatio(Number.NaN, 10), 0);
    assertEqual(progressRatio(5, 0), 0);
    assertEqual(remainingSeconds(4, 10), 6);
    assertEqual(remainingSeconds(14, 10), 0);
});

test('cache eviction keeps the newest files under both caps', () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
        path: `f${index}`,
        size: 10,
        modifiedMs: index,
    }));
    assertEqual(selectVoiceEvictions(files, 3, 1000), ['f0', 'f1']);
    assertEqual(selectVoiceEvictions(files, 100, 25), ['f0', 'f1', 'f2']);
    assertEqual(
        selectVoiceEvictions(
            files,
            MAX_VOICE_CACHE_FILES,
            MAX_VOICE_CACHE_BYTES,
        ),
        [],
    );
});

test('voice preview label and durations', () => {
    assertEqual(formatDuration(0), '0:00');
    assertEqual(formatDuration(23), '0:23');
    assertEqual(formatDuration(3723), '1:02:03');
    assertEqual(voicePreviewLabel(23), '🎤 Voice message 0:23');
    assertEqual(voicePreviewLabel(null), '🎤 Voice message');
    assertEqual(
        attachmentPreviewLabel(1, 'voice', null, 23),
        '🎤 Voice message 0:23',
    );
});

test('a 413 on a voice upload is a voice-specific reason', () => {
    assertEqual(
        uploadFailureReason(413, null, 'voice'),
        'Voice message too large',
    );
    assertEqual(uploadFailureReason(413, null, 'file'), 'File too large');
    assertEqual(
        uploadFailureReason(503, {
            message: 'Audio processing is unavailable',
        }),
        'Audio processing is unavailable',
    );
});

if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    const nodeProcess = (globalThis as { process?: { exitCode?: number } })
        .process;
    if (nodeProcess !== undefined) nodeProcess.exitCode = 1;
} else {
    console.log('All voice helper tests passed');
}
