import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { ReconnectingBanner } from '../../core/socket/connection-banner';
import { useAuthScreenGuard, useIsRestoringSession } from '../../features/auth';
import { GatePlaceholder } from '../../shared/components';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import { useTheme } from '../../shared/theme';

/**
 * Protected zone. Guests are redirected to the signIn screens; the guard also
 * re-engages after every logout (store flips to 'guest').
 *
 * A real stack (not `Slot`): pushing the user-info screen over a chat must keep
 * the chat mounted — its scroll position, composer draft and joined room — and
 * `useLeaveChatRoomOnUnmount` must fire only when the chat is truly popped.
 * Every screen draws its own header, so the native one stays hidden.
 */

export default function ProtectedLayout(): React.ReactElement {
    const isRestoring = useIsRestoringSession();
    const reduceMotion = useReducedMotion();
    const theme = useTheme();
    // Runs the guard effect: guests get redirected to /(auth)/login.
    useAuthScreenGuard('protected');

    /**
     * Profile routes (see `opaque-route.tsx`) cover the global app background
     * with an opaque theme canvas. Set here, once per route, so the screens
     * themselves stay background-agnostic.
     */
    const opaqueOptions = {
        contentStyle: { backgroundColor: theme.colors.background },
    };

    if (isRestoring) {
        return <GatePlaceholder />;
    }

    return (
        <View style={styles.root}>
            <Stack
                screenOptions={{
                    headerShown: false,
                    animation: reduceMotion ? 'none' : 'slide_from_right',
                    // Transparent: the root background layer is the canvas.
                    contentStyle: { backgroundColor: 'transparent' },
                }}
            >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="chat/[chatId]" />
                <Stack.Screen name="create-group" />
                <Stack.Screen name="new-chat" />
                <Stack.Screen name="profile-edit" />
                <Stack.Screen name="appearance" />
                <Stack.Screen name="user/[userId]" options={opaqueOptions} />
                <Stack.Screen name="group/[chatId]" options={opaqueOptions} />
                <Stack.Screen
                    name="group-settings/[chatId]/index"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/info"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/add-members"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/invite-links"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/banned"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/admin-permissions"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/member-permissions"
                    options={opaqueOptions}
                />
                <Stack.Screen
                    name="group-settings/[chatId]/member-overrides"
                    options={opaqueOptions}
                />
            </Stack>
            {/* Visible only when the socket has been down for more than 3 s. */}
            <ReconnectingBanner />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
});
