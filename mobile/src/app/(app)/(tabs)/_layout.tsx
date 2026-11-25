import { Tabs } from 'expo-router/js-tabs';
import { PillTabBar } from '../../../shared/tab-bar';

/**
 * Tab group inside the protected stack. The group name is parenthesised, so
 * every URL keeps working (`/`, `/profile`, `/contacts`, `/settings`).
 *
 * The pill bar is a custom `tabBar`: it is absolutely positioned, so the
 * navigator does not reserve space for it. Every tab screen reserves the room
 * itself via `useTabBarInset()`. Pushed screens (chat, group info, media…)
 * live in the stack ABOVE this navigator, so the bar disappears automatically.
 */

export const unstable_settings = {
    initialRouteName: 'index',
};

export default function TabsLayout(): React.ReactElement {
    return (
        <Tabs
            tabBar={(props): React.ReactElement => <PillTabBar {...props} />}
            screenOptions={{
                headerShown: false,
                // Transparent: the root background layer shows through.
                sceneStyle: { backgroundColor: 'transparent' },
            }}
        >
            <Tabs.Screen name="index" />
            <Tabs.Screen name="contacts" />
            <Tabs.Screen name="profile" />
            <Tabs.Screen name="settings" />
        </Tabs>
    );
}
