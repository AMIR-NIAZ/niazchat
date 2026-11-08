import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSocket } from '../../core/socket';

/**
 * Emits `userTyping` / `userEndTyping` for the open GROUP chat.
 *
 * First keystroke sends immediately, then at most one refresh every 2.5 s.
 * `userEndTyping` is sent on clear, send/blur (callers), 3 s idle, background,
 * unmount and chat change. Never emits while disconnected or for private chats.
 */

const TYPING_REFRESH_MS = 2500;
const TYPING_IDLE_MS = 3000;

export interface TypingEmitterApi {
    onChangeText: (text: string) => void;
    onBlur: () => void;
    stopTyping: () => void;
}

export function useTypingEmitter(
    chatId: number,
    enabled: boolean,
): TypingEmitterApi {
    const socket = useSocket();
    const socketRef = useRef(socket);
    socketRef.current = socket;
    const chatIdRef = useRef(chatId);
    chatIdRef.current = chatId;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    const activeRef = useRef(false);
    const lastSentAtRef = useRef(0);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearIdle = useCallback((): void => {
        if (idleTimerRef.current !== null) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    const emit = useCallback((event: 'userTyping' | 'userEndTyping'): void => {
        const current = socketRef.current;
        if (current === null || !current.connected) {
            return;
        }
        current.emit(event, { chatId: chatIdRef.current }, () => {});
    }, []);

    const stopTyping = useCallback((): void => {
        clearIdle();
        if (!activeRef.current) {
            return;
        }
        activeRef.current = false;
        emit('userEndTyping');
    }, [clearIdle, emit]);

    const onChangeText = useCallback(
        (text: string): void => {
            if (!enabledRef.current) {
                return;
            }
            if (text.trim() === '') {
                stopTyping();
                return;
            }
            const now = Date.now();
            if (!activeRef.current) {
                activeRef.current = true;
                lastSentAtRef.current = now;
                emit('userTyping');
            } else if (now - lastSentAtRef.current >= TYPING_REFRESH_MS) {
                lastSentAtRef.current = now;
                emit('userTyping');
            }
            clearIdle();
            idleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
        },
        [clearIdle, emit, stopTyping],
    );

    // Leaving the group / disabling typing ends the indicator immediately.
    useEffect((): void => {
        if (!enabled) {
            stopTyping();
        }
    }, [enabled, stopTyping]);

    // Backgrounding the app must not leave a stuck indicator.
    useEffect((): (() => void) => {
        const subscription = AppState.addEventListener(
            'change',
            (state): void => {
                if (state !== 'active') {
                    stopTyping();
                }
            },
        );
        return (): void => subscription.remove();
    }, [stopTyping]);

    // Unmount / chat change: best-effort stop on the socket that is still live.
    useEffect((): (() => void) => {
        return (): void => {
            clearIdle();
            if (!activeRef.current) {
                return;
            }
            activeRef.current = false;
            const current = socketRef.current;
            if (current !== null && current.connected) {
                current.emit('userEndTyping', { chatId }, () => {});
            }
        };
    }, [chatId, clearIdle]);

    return { onChangeText, onBlur: stopTyping, stopTyping };
}
