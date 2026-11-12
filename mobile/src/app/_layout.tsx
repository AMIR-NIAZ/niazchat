import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
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
import { I18nManager } from 'react-native';

I18nManager.allowRTL(false);
I18nManager.forceRTL(false);
/**
 * Root layout:
 * 1. Registers the auth token provider (HTTP client ↔ session layer wiring).
 * 2. Starts the session lifecycle (foreground / proactive refresh).
 * 3. Restores the stored session, refreshing BEFORE any protected screen,
 *    socket connection or query.
 * 4. Provides TanStack Query to the whole app.
 *
 * Auth gating lives in the route groups: `(app)` is protected, `(auth)` is
 * guest-only (via `useAuthScreenGuard`). An `unreachable` cold start shows a
 * retry screen instead of redirecting to login.
 */

export default function RootLayout(): React.ReactElement {
    const [providersReady, setProvidersReady] = useState(false);
    const status = useAuthStore((state) => state.status);

    useEffect(() => {
        let cancelled = false;
        registerAuthTokenProvider();
        const stopLifecycle = startSessionLifecycle();
        const bootstrap = async (): Promise<void> => {
            await useAuthStore.getState().restoreSession();
            if (!cancelled) {
                setProvidersReady(true);
            }
        };
        void bootstrap();
        return () => {
            cancelled = true;
            stopLifecycle();
        };
    }, []);

    if (!providersReady || status === 'restoring') {
        return <BootstrapPlaceholder />;
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

    return (
        <QueryClientProvider client={appQueryClient}>
            <SafeAreaProvider>
                <StatusBar style="light" />
                <Stack
                    screenOptions={{
                        headerShown: false,
                        animation: 'fade',
                        contentStyle: { backgroundColor: palette.background },
                    }}
                >
                    <Stack.Screen name="join/[code]" />
                </Stack>
            </SafeAreaProvider>
        </QueryClientProvider>
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
    unreachableScreen: {
        justifyContent: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: palette.background,
    },
    unreachableBody: { gap: spacing.xs },
    unreachableText: { color: palette.neutral[500], textAlign: 'center' },
});
