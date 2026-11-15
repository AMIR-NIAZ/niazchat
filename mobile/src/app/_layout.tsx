import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, I18nManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
    AppText,
    FormButton,
    Screen,
    palette,
    spacing,
} from '../shared/components';
import {
    registerAuthTokenProvider,
    startSessionLifecycle,
    useAuthStore,
} from '../features/auth';
import { appQueryClient } from '../core/query/query-client';
import {
    PERSIST_BUSTER,
    PERSIST_MAX_AGE_MS,
    persistedQueryClientPersister,
    shouldPersistQuery,
} from '../core/query/query-persister';
import { initVideoDownloader } from '../shared/media-cache';
import { startMessagesMirror } from '../shared/local-db';
import { ContextPopupProvider } from '../shared/context-popup';
import { DialogProvider } from '../shared/dialog';
import { MediaViewerProvider } from '../features/attachments';

I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

/**
 * Root layout:
 * 1. Registers the auth token provider (HTTP client ↔ session layer wiring).
 * 2. Starts the session lifecycle (foreground / proactive refresh).
 * 3. Restores the stored session from SecureStore. This NEVER waits for the
 *    network: with a stored token the app opens immediately with the cached
 *    profile/chat list, and the session layer refreshes in the background.
 * 4. Restores the persisted query cache (per-user AsyncStorage key).
 * 5. Provides TanStack Query to the whole app and mirrors message changes into
 *    SQLite.
 *
 * The app renders only after both the auth hydration and the query-cache
 * restore finish; a 1.5 s fallback keeps a slow/broken restore from blocking
 * startup. Auth gating lives in the route groups: `(app)` is protected,
 * `(auth)` is guest-only (via `useAuthScreenGuard`).
 */

const RESTORE_GATE_TIMEOUT_MS = 1500;

const persistOptions = {
    persister: persistedQueryClientPersister,
    buster: PERSIST_BUSTER,
    maxAge: PERSIST_MAX_AGE_MS,
    dehydrateOptions: {
        shouldDehydrateQuery: shouldPersistQuery,
    },
};

export default function RootLayout(): React.ReactElement {
    const status = useAuthStore((state) => state.status);
    const [persistRestored, setPersistRestored] = useState(false);
    const [restoreTimedOut, setRestoreTimedOut] = useState(false);

    useEffect(() => {
        registerAuthTokenProvider();
        // Delete leftover `.part` files from interrupted media downloads and
        // mark fully downloaded videos `ready` before the first bubble renders.
        void initVideoDownloader();
        const stopLifecycle = startSessionLifecycle();
        // The mirror re-checks the identity on every flush, so it can start
        // before (or without) a login and survives logout/login.
        startMessagesMirror();
        void useAuthStore.getState().restoreSession();
        return (): void => {
            stopLifecycle();
        };
    }, []);

    // Fallback: never let a broken/slow restore block the UI.
    useEffect((): (() => void) => {
        const timer = setTimeout((): void => {
            setRestoreTimedOut(true);
        }, RESTORE_GATE_TIMEOUT_MS);
        return (): void => clearTimeout(timer);
    }, []);

    if (status === 'restoring') {
        return (
            <SafeAreaProvider>
                <StatusBar style="light" />
                <BootstrapPlaceholder />
            </SafeAreaProvider>
        );
    }

    if (status === 'unreachable') {
        return (
            <QueryClientProvider client={appQueryClient}>
                <SafeAreaProvider>
                    <StatusBar style="light" />
                    <ServerUnreachableScreen
                        onRetry={(): void => {
                            void useAuthStore.getState().retryRestore();
                        }}
                    />
                </SafeAreaProvider>
            </QueryClientProvider>
        );
    }

    const authenticated = status === 'authenticated';
    const gateOpen = !authenticated || persistRestored || restoreTimedOut;

    if (!authenticated) {
        // Guests never touch the persisted cache (no identity).
        return (
            <QueryClientProvider client={appQueryClient}>
                <AppTree />
            </QueryClientProvider>
        );
    }

    return (
        <PersistQueryClientProvider
            client={appQueryClient}
            persistOptions={persistOptions}
            onSuccess={(): void => setPersistRestored(true)}
            onError={(): void => setPersistRestored(true)}
        >
            {gateOpen ? (
                <AppTree />
            ) : (
                <SafeAreaProvider>
                    <StatusBar style="light" />
                    <BootstrapPlaceholder />
                </SafeAreaProvider>
            )}
        </PersistQueryClientProvider>
    );
}

/** Providers + navigator shared by authenticated and guest sessions. */
function AppTree(): React.ReactElement {
    return (
        <GestureHandlerRootView style={styles.root}>
            <SafeAreaProvider>
                <StatusBar style="light" />
                {/* Overlay stacking, painted in this order:
                    navigator < media viewer (900) < context popups (1000)
                    < dialogs and toasts (1100).

                    Each provider draws its host AFTER `children`, so the
                    nesting below is the stacking order: the viewer is the
                    innermost child (painted first, above the navigator),
                    then the popup host, then the dialog/toast host. */}
                <DialogProvider>
                    <ContextPopupProvider>
                        <MediaViewerProvider>
                            <Stack
                                screenOptions={{
                                    headerShown: false,
                                    animation: 'fade',
                                    contentStyle: {
                                        backgroundColor: palette.background,
                                    },
                                }}
                            >
                                <Stack.Screen name="join/[code]" />
                            </Stack>
                        </MediaViewerProvider>
                    </ContextPopupProvider>
                </DialogProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

function BootstrapPlaceholder(): React.ReactElement {
    return (
        <Screen
            style={{
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <AppText variant="display" style={{ marginBottom: spacing.xs }}>
                NiazChat
            </AppText>
            <AppText variant="caption">Loading…</AppText>
        </Screen>
    );
}

/** Cold start where the refresh could not run and the stored token is unusable. */
function ServerUnreachableScreen({
    onRetry,
}: {
    onRetry: () => void;
}): React.ReactElement {
    return (
        <Screen style={styles.unreachableScreen}>
            <View style={styles.unreachableBody}>
                <AppText variant="title">Can&apos;t reach the server</AppText>
                <AppText style={styles.unreachableText}>
                    Check your connection. We&apos;ll keep trying automatically.
                </AppText>
            </View>
            <FormButton label="Retry" onPress={onRetry} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    unreachableScreen: {
        justifyContent: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: palette.background,
    },
    unreachableBody: { gap: spacing.xs },
    unreachableText: { color: palette.neutral[500], textAlign: 'center' },
});
