import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import {
    AudioQuality,
    RecordingPresets,
    getRecordingPermissionsAsync,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioRecorder,
    useAudioRecorderState,
    type RecordingOptions,
} from 'expo-audio';
import {
    normalizePeaks,
    meteringLevel,
    reachedRecordingLimit,
    shouldDiscardRecording,
} from './recording-machine';
import { stopVoice } from './voice-playback';
import {
    getVoiceDraft,
    setVoiceDraft,
    takeVoiceDraft,
    discardVoiceDraft,
} from './voice-draft-store';
import type { VoiceDraft } from './voice-draft-store';
import { VOICE_WAVEFORM_BARS } from '../attachments/constants';

/**
 * AAC in an MP4 container (.m4a), mono, 48 kbps, 44.1 kHz on both platforms:
 * small enough for a 10-minute message, playable by both platforms.
 */
const VOICE_RECORDING_OPTIONS: RecordingOptions = {
    ...RecordingPresets.HIGH_QUALITY,
    extension: '.m4a',
    sampleRate: 44_100,
    numberOfChannels: 1,
    bitRate: 48_000,
    isMeteringEnabled: true,
    android: {
        ...RecordingPresets.HIGH_QUALITY.android,
        extension: '.m4a',
        sampleRate: 44_100,
    },
    ios: {
        ...RecordingPresets.HIGH_QUALITY.ios,
        extension: '.m4a',
        sampleRate: 44_100,
        audioQuality: AudioQuality.HIGH,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
    },
    web: { mimeType: 'audio/mp4', bitsPerSecond: 48_000 },
};

export type VoiceRecorderPhase = 'idle' | 'recording';

export interface VoiceRecorderApi {
    phase: VoiceRecorderPhase;
    phaseRef: React.RefObject<VoiceRecorderPhase>;
    durationMs: number;
    level: number;
    draft: VoiceDraft | null;
    hint: string | null;
    start: () => Promise<void>;
    /** Stops and returns the clip when it is long enough; otherwise discards it. */
    finish: () => Promise<VoiceDraft | null>;
    /** Stops and discards (slide-to-cancel / trash). */
    cancel: () => Promise<void>;
    /** Stops and keeps the clip in the composer tray (auto-stop/interruption). */
    stopToDraft: () => Promise<void>;
    takeDraft: () => VoiceDraft | null;
    discardDraft: () => void;
    clearHint: () => void;
}

/**
 * Recorder state machine on top of expo-audio. Records in the foreground only:
 * backgrounding/interruptions stop and keep a draft instead of losing audio.
 */
export function useVoiceRecorder(chatId: number): VoiceRecorderApi {
    const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
    const recorderState = useAudioRecorderState(recorder, 100);
    const [phase, setPhase] = useState<VoiceRecorderPhase>('idle');
    const [draft, setDraftState] = useState<VoiceDraft | null>(() =>
        getVoiceDraft(chatId),
    );
    const [level, setLevel] = useState(0);
    const [hint, setHint] = useState<string | null>(null);

    const phaseRef = useRef<VoiceRecorderPhase>('idle');
    phaseRef.current = phase;
    const meteringRef = useRef<number | undefined>(undefined);
    meteringRef.current = recorderState.metering;
    const durationRef = useRef(0);
    durationRef.current = recorderState.durationMillis;
    const peaksRef = useRef<number[]>([]);

    useEffect((): void => {
        setDraftState(getVoiceDraft(chatId));
    }, [chatId]);

    const persistDraft = useCallback(
        (next: VoiceDraft | null): void => {
            setDraftState(next);
            if (next === null) {
                void discardVoiceDraft(chatId);
            } else {
                setVoiceDraft(chatId, next);
            }
        },
        [chatId],
    );

    const start = useCallback(async (): Promise<void> => {
        if (phaseRef.current === 'recording') return;
        try {
            let permission = await getRecordingPermissionsAsync();
            if (!permission.granted) {
                permission = await requestRecordingPermissionsAsync();
            }
            if (!permission.granted) {
                Alert.alert(
                    'Microphone access needed',
                    'Allow microphone access in Settings to record voice messages.',
                    [
                        { text: 'Not now', style: 'cancel' },
                        {
                            text: 'Open settings',
                            onPress: (): void => {
                                void Linking.openSettings();
                            },
                        },
                    ],
                );
                return;
            }

            // Only one audio session: never record while a voice plays.
            stopVoice();
            peaksRef.current = [];
            setLevel(0);
            setHint(null);
            await setAudioModeAsync({
                allowsRecording: true,
                playsInSilentMode: true,
                shouldRouteThroughEarpiece: false,
            });
            await recorder.prepareToRecordAsync();
            recorder.record();
            setPhase('recording');
        } catch {
            setPhase('idle');
            await setAudioModeAsync({
                allowsRecording: false,
                playsInSilentMode: true,
                shouldRouteThroughEarpiece: false,
            }).catch((): void => undefined);
            Alert.alert(
                'Could not start recording',
                'The microphone is unavailable right now. Try again.',
            );
        }
    }, [recorder]);

    const restorePlaybackMode = useCallback(async (): Promise<void> => {
        await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
            shouldRouteThroughEarpiece: false,
            interruptionMode: 'doNotMix',
        }).catch((): void => undefined);
    }, []);

    const stopRecorder = useCallback(async (): Promise<void> => {
        try {
            await recorder.stop();
        } catch {
            // A system interruption can invalidate the recorder; the file (if
            // any) is still reported through recorder.uri.
        }
        setPhase('idle');
        await restorePlaybackMode();
    }, [recorder, restorePlaybackMode]);

    const finish = useCallback(async (): Promise<VoiceDraft | null> => {
        if (phaseRef.current !== 'recording') return null;
        const elapsedMs = durationRef.current;
        await stopRecorder();
        const uri = recorder.uri;
        if (uri === null) return null;
        const seconds = elapsedMs / 1000;
        if (shouldDiscardRecording(seconds)) {
            await discardVoiceDraftFile(uri);
            setHint('Tap and hold to record');
            return null;
        }
        return {
            uri,
            duration: Math.round(seconds * 10) / 10,
            waveform: normalizePeaks(peaksRef.current, VOICE_WAVEFORM_BARS),
        };
    }, [recorder, stopRecorder]);

    const cancel = useCallback(async (): Promise<void> => {
        if (phaseRef.current !== 'recording') return;
        await stopRecorder();
        if (recorder.uri !== null) {
            await discardVoiceDraftFile(recorder.uri);
        }
        setHint(null);
    }, [recorder, stopRecorder]);

    const stopToDraft = useCallback(async (): Promise<void> => {
        const next = await finish();
        if (next !== null) {
            persistDraft(next);
        }
    }, [finish, persistDraft]);

    // Live level meter + up to 64 peaks for the pending bubble.
    useEffect((): (() => void) | void => {
        if (phase !== 'recording') return;
        const timer = setInterval((): void => {
            const nextLevel = meteringLevel(meteringRef.current);
            setLevel(nextLevel);
            peaksRef.current.push(nextLevel);
            if (peaksRef.current.length > VOICE_WAVEFORM_BARS) {
                peaksRef.current.shift();
            }
        }, 150);
        return (): void => clearInterval(timer);
    }, [phase]);

    // 10 minutes: auto-stop and keep the clip as a draft.
    useEffect((): void => {
        if (
            phase === 'recording' &&
            reachedRecordingLimit(durationRef.current)
        ) {
            void stopToDraft();
        }
    }, [phase, recorderState.durationMillis, stopToDraft]);

    // Background/call: stop recording, never keep the mic open.
    useEffect((): (() => void) => {
        const subscription = AppState.addEventListener(
            'change',
            (next): void => {
                if (next !== 'active' && phaseRef.current === 'recording') {
                    void stopToDraft();
                }
            },
        );
        return (): void => subscription.remove();
    }, [stopToDraft]);

    const takeDraft = useCallback((): VoiceDraft | null => {
        setDraftState(null);
        return takeVoiceDraft(chatId);
    }, [chatId]);

    const discardDraft = useCallback((): void => {
        setDraftState(null);
        void discardVoiceDraft(chatId);
    }, [chatId]);

    const clearHint = useCallback((): void => setHint(null), []);

    return {
        phase,
        phaseRef,
        durationMs: phase === 'recording' ? recorderState.durationMillis : 0,
        level,
        draft,
        hint,
        start,
        finish,
        cancel,
        stopToDraft,
        takeDraft,
        discardDraft,
        clearHint,
    };
}

async function discardVoiceDraftFile(uri: string): Promise<void> {
    const FileSystem = await import('expo-file-system/legacy');
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
        (): void => undefined,
    );
}
