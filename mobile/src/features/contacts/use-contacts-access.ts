import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Contacts from 'expo-contacts/legacy';

/**
 * Contacts permission state machine:
 *
 * `unknown → rationale → requesting → granted | denied | blocked | limited`
 * plus `notNow`, the in-app "Not now" answer (the OS prompt was never shown).
 *
 * - Checked on FOCUS (and when the app returns to the foreground), never at
 *   app start, and the OS prompt only runs from `allow()`.
 * - iOS limited access counts as granted: the exposed contacts are used.
 * - `blocked` (never ask again) stays readable and recovers automatically once
 *   the user grants access in Settings and comes back.
 */

export type ContactsAccessState =
    | 'checking'
    | 'rationale'
    | 'requesting'
    | 'granted'
    | 'limited'
    | 'denied'
    | 'blocked'
    | 'notNow';

export interface ContactsAccessApi {
    state: ContactsAccessState;
    canRead: boolean;
    allow: () => void;
    notNow: () => void;
    openSettings: () => void;
}

function stateFromResponse(
    response: Contacts.ContactsPermissionResponse,
    current: ContactsAccessState,
): ContactsAccessState {
    if (response.granted) {
        return response.accessPrivileges === 'limited' ? 'limited' : 'granted';
    }
    if (response.status === Contacts.PermissionStatus.UNDETERMINED) {
        return current === 'notNow' ? 'notNow' : 'rationale';
    }
    if (response.canAskAgain === false) {
        return 'blocked';
    }
    return current === 'notNow' ? 'notNow' : 'denied';
}

export function useContactsAccess(): ContactsAccessApi {
    const [state, setState] = useState<ContactsAccessState>('checking');

    const check = useCallback(async (): Promise<void> => {
        try {
            const response = await Contacts.getPermissionsAsync();
            setState((current) =>
                current === 'requesting'
                    ? current
                    : stateFromResponse(response, current),
            );
        } catch {
            setState('blocked');
        }
    }, []);

    // Only when the tab is actually opened — never on app start.
    useFocusEffect(
        useCallback((): void => {
            void check();
        }, [check]),
    );

    // Returning from Settings must resume without any extra tap.
    useEffect((): (() => void) => {
        const subscription = AppState.addEventListener(
            'change',
            (next): void => {
                if (next === 'active') {
                    void check();
                }
            },
        );
        return (): void => subscription.remove();
    }, [check]);

    const allow = useCallback((): void => {
        setState('requesting');
        void (async (): Promise<void> => {
            try {
                const response = await Contacts.requestPermissionsAsync();
                setState(stateFromResponse(response, 'rationale'));
            } catch {
                setState('blocked');
            }
        })();
    }, []);

    const notNow = useCallback((): void => {
        setState('notNow');
    }, []);

    const openSettings = useCallback((): void => {
        void Linking.openSettings();
    }, []);

    return {
        state,
        canRead: state === 'granted' || state === 'limited',
        allow,
        notNow,
        openSettings,
    };
}
