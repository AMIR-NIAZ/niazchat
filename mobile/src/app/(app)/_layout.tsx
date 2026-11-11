import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { ReconnectingBanner } from '../../core/socket/connection-banner';
import { useAuthScreenGuard, useIsRestoringSession } from '../../features/auth';
import { GatePlaceholder } from '../../shared/components';

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
    // Runs the guard effect: guests get redirected to /(auth)/login.
    useAuthScreenGuard('protected');

    if (isRestoring) {
        return <GatePlaceholder />;
    }

    return (
        <View style={styles.root}>
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="chat/[chatId]" />
                <Stack.Screen name="create-group" />
                <Stack.Screen name="new-chat" />
                <Stack.Screen name="profile" />
                <Stack.Screen name="profile-edit" />
                <Stack.Screen name="user/[userId]" />
                <Stack.Screen name="group/[chatId]" />
                <Stack.Screen name="group-settings/[chatId]/index" />
                <Stack.Screen name="group-settings/[chatId]/info" />
                <Stack.Screen name="group-settings/[chatId]/invite-links" />
            </Stack>
            {/* Visible only when the socket has been down for more than 3 s. */}
            <ReconnectingBanner />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
});
