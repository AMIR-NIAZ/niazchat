import { bindSocketEvent } from './socket-event';
import type { AppSocket } from './socket';

/**
 * `useSocketEvent` is built on this helper: the handler is read at delivery
 * time and the listener is tied to ONE instance. These tests pin the two
 * failure modes that caused stale listeners — a replaced socket instance and a
 * changed handler identity — without needing a renderer.
 */

type Listener = (...args: unknown[]) => void;

function fakeSocket(): {
    socket: AppSocket;
    emit: (event: string, ...args: unknown[]) => void;
    listenerCount: (event: string) => number;
} {
    const listeners = new Map<string, Set<Listener>>();
    const socket = {
        on(event: string, listener: Listener): void {
            const set = listeners.get(event) ?? new Set<Listener>();
            set.add(listener);
            listeners.set(event, set);
        },
        off(event: string, listener: Listener): void {
            listeners.get(event)?.delete(listener);
        },
    } as unknown as AppSocket;
    return {
        socket,
        emit: (event, ...args): void => {
            for (const listener of [...(listeners.get(event) ?? [])]) {
                listener(...args);
            }
        },
        listenerCount: (event): number => listeners.get(event)?.size ?? 0,
    };
}

describe('bindSocketEvent', () => {
    it('delivers to the CURRENT handler without re-subscribing', () => {
        const { socket, emit, listenerCount } = fakeSocket();
        const seen: string[] = [];
        let handler = (value: string): void => {
            seen.push(`old:${value}`);
        };

        const detach = bindSocketEvent(socket, 'sendMessage:list', () => {
            return handler as unknown as (...args: never[]) => void;
        });
        expect(listenerCount('sendMessage:list')).toBe(1);

        // A new handler identity must not add a second listener.
        handler = (value: string): void => {
            seen.push(`new:${value}`);
        };
        emit('sendMessage:list', 'm1');
        expect(seen).toEqual(['new:m1']);
        expect(listenerCount('sendMessage:list')).toBe(1);

        detach();
        expect(listenerCount('sendMessage:list')).toBe(0);
        emit('sendMessage:list', 'm2');
        expect(seen).toEqual(['new:m1']);
    });

    it('a listener bound to an old instance never hears the new one', () => {
        const first = fakeSocket();
        const second = fakeSocket();
        const seen: string[] = [];
        const handler = (value: string): void => {
            seen.push(value);
        };

        const detachFirst = bindSocketEvent(first.socket, 'seen', () => {
            return handler as unknown as (...args: never[]) => void;
        });
        // Instance replaced: exactly what useSocketEvent's effect does.
        detachFirst();
        const detachSecond = bindSocketEvent(second.socket, 'seen', () => {
            return handler as unknown as (...args: never[]) => void;
        });

        first.emit('seen', 'dead');
        second.emit('seen', 'live');
        expect(seen).toEqual(['live']);
        expect(first.listenerCount('seen')).toBe(0);
        expect(second.listenerCount('seen')).toBe(1);
        detachSecond();
    });

    it('is a no-op without a socket (signed out)', () => {
        const detach = bindSocketEvent(null, 'seen', () => () => undefined);
        expect(() => detach()).not.toThrow();
    });
});
