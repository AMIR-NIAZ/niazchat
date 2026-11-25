import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { BlurTargetView } from 'expo-blur';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import { useFonts } from 'expo-font';
import { Image } from 'expo-image';
import {
    I18nManager,
    Platform,
    StyleSheet,
    View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
    AppText,
    FormButton,
    OpaqueRouteProvider,
    Screen,
    spacing,
} from '../shared/components';
import { GlassBlurTargetContext } from '../shared/components/glass-surface';
import { FONT_ASSETS, ThemeProvider } from '../shared/theme';
import {
    useAppearanceHydrated,
    useAppearanceStore,
} from '../features/settings';
import {
    AppBackgroundLayer,
    useAppBackgroundIsLight,
} from '../features/settings/app-background-layer';
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
import { MusicPlayerProvider } from '../shared/music-player';

I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

// Keep the native splash up until the persisted appearance and fonts are ready
// (the background is part of the appearance snapshot).
void SplashScreen.preventAutoHideAsync().catch((): void => undefined);

/**
 * Root layout:
 * 0. Keeps the native splash up until the bundled fonts are registered and the
 *    persisted appearance is restored — so the first painted frame already has
 *    the right theme, accent and font (no default-appearance flicker).
 * 1. Wraps everything in the ThemeProvider (live light/dark + accent).
 * 2. Registers the auth token provider (HTTP client ↔ session layer wiring).
 * 3. Starts the session lifecycle (foreground / proactive refresh).
 * 4. Restores the stored session from SecureStore. This NEVER waits for the
 *    network: with a stored token the app opens immediately with the cached
 *    profile/chat list, and the session layer refreshes in the background.
 * 5. Restores the persisted query cache (per-user AsyncStorage key).
 * 6. Provides TanStack Query to the whole app and mirrors message changes into
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
    const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
    const appearanceHydrated = useAppearanceHydrated();
    // Android blur target for every `GlassSurface` (new expo-blur API).
    const blurTargetRef = useRef<ComponentRef<typeof View> | null>(null);
    // A font failure must not brick the app: fall back to the system font.
    const fontsReady = fontsLoaded || fontError !== null;
    const ready = appearanceHydrated && fontsReady;

    // Hold the splash until the background image is decoded (or 1.2 s at
    // most), so the first visible frame already has the right background.
    useEffect((): (() => void) => {
        if (!ready) {
            return (): void => undefined;
        }
        let cancelled = false;
        const hide = (): void => {
            if (!cancelled) {
                void SplashScreen.hideAsync().catch((): void => undefined);
            }
        };
        const { appBackground, customBackground } =
            useAppearanceStore.getState();
        if (appBackground.kind === 'image' && customBackground !== null) {
            void Promise.race([
                Image.prefetch(customBackground.uri),
                new Promise<void>((resolve) => {
                    setTimeout(resolve, 1200);
                }),
            ]).then(hide, hide);
        } else {
            requestAnimationFrame(hide);
        }
        return (): void => {
            cancelled = true;
        };
    }, [ready]);

    return (
        <ThemeProvider>
            {/* Route-scoped theme: profile routes swap every translucent surface
                for an opaque one and cover the app background. */}
            <OpaqueRouteProvider>
                <GlassBlurTargetContext.Provider value={blurTargetRef}>
                    {/* The one background for the whole app. It sits behind the
                        navigator (and behind the bootstrap gate), fills the
                        window edge to edge, and never re-mounts on navigation.
                        It is also the `BlurTargetView` that Android glass
                        surfaces blur. */}
                    <View style={styles.root}>
                        <BlurTargetView
                            ref={blurTargetRef}
                            pointerEvents="none"
                            style={StyleSheet.absoluteFill}
                        >
                            <AppBackgroundLayer />
                        </BlurTargetView>
                        {ready ? <RootContent /> : <BootstrapGate />}
                    </View>
                </GlassBlurTargetContext.Provider>
            </OpaqueRouteProvider>
        </ThemeProvider>
    );
}

/** Themed stand-in while fonts / appearance restore (native splash is behind). */
function BootstrapGate(): React.ReactElement {
    return (
        <SafeAreaProvider style={styles.root}>
            <ThemedStatusBar />
            <View
                style={[
                    styles.gate,
                    { backgroundColor: 'transparent' },
                ]}
            />
        </SafeAreaProvider>
    );
}

function RootContent(): React.ReactElement {
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
                <ThemedStatusBar />
                <BootstrapPlaceholder />
            </SafeAreaProvider>
        );
    }

    if (status === 'unreachable') {
        return (
            <QueryClientProvider client={appQueryClient}>
                <SafeAreaProvider>
                    <ThemedStatusBar />
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
                    <ThemedStatusBar />
                    <BootstrapPlaceholder />
                </SafeAreaProvider>
            )}
        </PersistQueryClientProvider>
    );
}

function ThemedStatusBar(): React.ReactElement {
    // Reads the global background, not just the theme: a light solid/gradient
    // needs dark icons even in dark mode.
    const isLight = useAppBackgroundIsLight();

    useEffect((): void => {
        if (Platform.OS !== 'android') {
            return;
        }
        // `light` = light nav bar with dark buttons.
        NavigationBar.setStyle(isLight ? 'light' : 'dark');
    }, [isLight]);

    return <StatusBar style={isLight ? 'dark' : 'light'} />;
}

/** Providers + navigator shared by authenticated and guest sessions. */
function AppTree(): React.ReactElement {
    return (
        <GestureHandlerRootView style={styles.root}>
            <SafeAreaProvider style={styles.root}>
                <ThemedStatusBar />
                {/* Overlay stacking, painted in this order:
                    navigator < media viewer (900) < context popups (1000)
                    < dialogs and toasts (1100).

                    Each provider draws its host AFTER `children`, so the
                    nesting below is the stacking order: the viewer is the
                    innermost child (painted first, above the navigator),
                    then the music bar (800)/sheet (850), then the popup host,
                    then the dialog/toast host. */}
                <DialogProvider>
                    <ContextPopupProvider>
                        <MediaViewerProvider>
                            <MusicPlayerProvider>
                                <Stack
                                    screenOptions={{
                                        headerShown: false,
                                        animation: 'fade',
                                        // Transparent so the root background
                                        // layer shows through every route.
                                        contentStyle: {
                                            backgroundColor: 'transparent',
                                        },
                                    }}
                                >
                                    <Stack.Screen name="join/[code]" />
                                </Stack>
                            </MusicPlayerProvider>
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
                <AppText variant="caption" style={styles.unreachableText}>
                    Check your connection. We&apos;ll keep trying automatically.
                </AppText>
            </View>
            <FormButton label="Retry" onPress={onRetry} />
        </Screen>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    gate: { flex: 1 },
    unreachableScreen: {
        justifyContent: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
    },
    unreachableBody: { gap: spacing.xs },
    unreachableText: { textAlign: 'center' },
});
