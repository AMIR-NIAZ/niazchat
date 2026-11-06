import { MutableRefObject, useEffect, useRef, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppText, Screen } from '../shared/components';
import { palette, spacing, typography } from '../shared/theme';
import { registerAuthTokenProvider, useAuthStore } from '../features/auth';
import { I18nManager } from 'react-native';

I18nManager.allowRTL(false);
I18nManager.forceRTL(false);
/**
 * Root layout:
 * 1. Registers the auth token provider (HTTP client ↔ SecureStore wiring).
 * 2. Restores any stored session (refreshing an expired access token).
 * 3. Provides TanStack Query to the whole app.
 *
 * Auth gating lives in the route groups: `(app)` is protected, `(auth)` is
 * guest-only (via `useAuthScreenGuard`).
 */

export default function RootLayout(): React.ReactElement {
  const queryClientRef: MutableRefObject<QueryClient | undefined> = useRef(undefined);
  if (queryClientRef.current === undefined) {
    queryClientRef.current = new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          staleTime: 30_000,
          refetchOnWindowFocus: false,
        },
      },
    });
  }

  const [providersReady, setProvidersReady] = useState(false);
  const restoreSession = useAuthStore((state) => state.restoreSession);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async (): Promise<void> => {
      registerAuthTokenProvider();
      await restoreSession();
      if (!cancelled) {
        setProvidersReady(true);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [restoreSession]);

  if (!providersReady || queryClientRef.current === undefined) {
    return <BootstrapPlaceholder />;
  }

  return (
    <QueryClientProvider client={queryClientRef.current}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
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
        backgroundColor: palette.neutral[0],
      }}
    >
      <AppText style={[typography.title, { marginBottom: spacing.xs }]}>NiazChat</AppText>
      <AppText variant="caption">Loading…</AppText>
    </Screen>
  );
}
