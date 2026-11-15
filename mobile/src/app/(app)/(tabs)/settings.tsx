import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
    Bell,
    ChevronRight,
    Info,
    Languages,
    LogOut,
    Palette,
    ShieldCheck,
    UserRound,
} from 'lucide-react-native';
import {
    AppText,
    GlassHeader,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { useTabBarInset } from '../../../shared/tab-bar';
import { logout } from '../../../features/auth';
import { useProfile } from '../../../features/users';

/**
 * App settings placeholder.
 *
 * Only "Log out" is functional today. Every other row is a real, visible
 * placeholder that is disabled and carries a "Soon" chip. Adding an option
 * later means editing `SETTINGS_ROWS` (and its `handlePress` branch) only.
 */

interface SettingsIconProps {
    size?: number;
    color?: string;
    strokeWidth?: number;
}

interface SettingsRowConfig {
    id: string;
    label: string;
    icon: React.ComponentType<SettingsIconProps>;
}

const SETTINGS_ROWS: readonly SettingsRowConfig[] = [
    { id: 'account', label: 'Account', icon: UserRound },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'privacy', label: 'Privacy & security', icon: ShieldCheck },
    { id: 'language', label: 'Language', icon: Languages },
    { id: 'about', label: 'About', icon: Info },
];

export default function SettingsScreen(): React.ReactElement {
    const tabBarInset = useTabBarInset();
    const profile = useProfile();
    const me = profile.view.profile;

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <GlassHeader>
                <AppText variant="heading">Settings</AppText>
                <AppText variant="caption">App preferences</AppText>
            </GlassHeader>

            <ScrollView
                contentContainerStyle={[
                    styles.scroll,
                    { paddingBottom: tabBarInset },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open your profile"
                    onPress={(): void => {
                        router.navigate('/(app)/profile');
                    }}
                    style={({ pressed }) => [
                        styles.profileCard,
                        pressed && styles.cardPressed,
                    ]}
                >
                    <UserAvatar
                        userId={me?.id ?? 0}
                        name={me?.name ?? 'You'}
                        uri={profile.view.currentAvatarUrl}
                        size={52}
                    />
                    <View style={styles.profileBody}>
                        <Text style={styles.profileName} numberOfLines={1}>
                            {me?.name ?? 'Your account'}
                        </Text>
                        <Text style={styles.profileHandle} numberOfLines={1}>
                            {me?.username === null || me?.username === undefined
                                ? 'View profile'
                                : `@${me.username}`}
                        </Text>
                    </View>
                    <ChevronRight
                        size={20}
                        color={palette.text.muted}
                        strokeWidth={2}
                    />
                </Pressable>

                <View style={styles.section}>
                    {SETTINGS_ROWS.map(
                        (row): React.ReactElement => (
                            <SettingsRow key={row.id} row={row} />
                        ),
                    )}
                </View>

                <View style={styles.section}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Log out"
                        onPress={(): void => {
                            void logout('manual');
                        }}
                        style={({ pressed }) => [
                            styles.row,
                            pressed && styles.cardPressed,
                        ]}
                    >
                        <LogOut
                            size={20}
                            color={palette.semantic.danger}
                            strokeWidth={2}
                        />
                        <Text style={[styles.rowLabel, styles.logoutLabel]}>
                            Log out
                        </Text>
                    </Pressable>
                </View>

                <Text style={styles.footer}>
                    More settings are on the way. Your chats, profile and
                    privacy controls stay available in the meantime.
                </Text>
            </ScrollView>
        </Screen>
    );
}

function SettingsRow({ row }: { row: SettingsRowConfig }): React.ReactElement {
    const Icon = row.icon;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.label} — coming soon`}
            accessibilityState={{ disabled: true }}
            disabled={true}
            style={styles.row}
        >
            <Icon size={20} color={palette.text.secondary} strokeWidth={2} />
            <Text style={styles.rowLabel}>{row.label}</Text>
            <View style={styles.soonChip}>
                <Text style={styles.soonText}>Soon</Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { paddingHorizontal: spacing.md, gap: spacing.sm },
    scroll: { paddingTop: spacing.xs, gap: spacing.md },
    profileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radii.lg,
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    cardPressed: { backgroundColor: palette.glass.elevated },
    profileBody: { flex: 1, gap: 2 },
    profileName: {
        color: palette.text.primary,
        fontSize: 16,
        fontWeight: '700',
    },
    profileHandle: { ...typography.caption, color: palette.text.secondary },
    section: {
        borderRadius: radii.lg,
        backgroundColor: palette.glass.surface,
        borderWidth: 1,
        borderColor: palette.border.subtle,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 54,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border.subtle,
    },
    rowLabel: {
        flex: 1,
        color: palette.text.primary,
        fontSize: 15,
        fontWeight: '600',
    },
    logoutLabel: { color: palette.semantic.danger },
    soonChip: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.full,
        backgroundColor: palette.glass.highlight,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    soonText: {
        color: palette.text.muted,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    footer: {
        color: palette.text.muted,
        fontSize: 12,
        lineHeight: 18,
        textAlign: 'center',
        paddingHorizontal: spacing.lg,
    },
});
