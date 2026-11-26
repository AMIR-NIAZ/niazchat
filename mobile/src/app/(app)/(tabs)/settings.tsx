import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import Animated from 'react-native-reanimated';
import {
    Bell,
    Check,
    ChevronRight,
    Info,
    Languages,
    LogOut,
    Palette,
    Plus,
    ShieldCheck,
    UserRound,
} from 'lucide-react-native';
import {
    AppText,
    GlassHeader,
    SafeText,
    Screen,
    UserAvatar,
    radii,
    spacing,
} from '../../../shared/components';
import {
    useTheme,
    useThemedStyles,
} from '../../../shared/theme';
import type { AppTheme } from '../../../shared/theme';
import { FadingScrollEdges } from '../../../shared/edge-fade';
import { useTabBarInset } from '../../../shared/tab-bar';
import { dialog, toast } from '../../../shared/dialog';
import { logoutAccount, switchAccount } from '../../../features/auth';
import { useProfile } from '../../../features/users';
import {
    MAX_ACCOUNTS,
    getAccounts,
    getActiveAccountId,
    updateAccountProfile,
} from '../../../core/accounts';
import type { StoredAccount } from '../../../core/accounts';

/**
 * App settings.
 *
 * Appearance is functional; every other row is a visible placeholder that is
 * disabled and carries a "Soon" chip. Adding an option later means editing
 * `SETTINGS_ROWS` (and its `handlePress` branch) only.
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
    /** Undefined = coming soon. */
    onPress?: () => void;
}

export default function SettingsScreen(): React.ReactElement {
    const tabBarInset = useTabBarInset();
    const insets = useSafeAreaInsets();
    const profile = useProfile();
    const me = profile.view.profile;
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    // Same full-screen geometry as the chats list: floating header, the
    // measured header height feeds both the content padding and the fade.
    const [headerHeight, setHeaderHeight] = useState(0);
    const [accounts, setAccounts] = useState<StoredAccount[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
    // Account whose tokens are being switched/removed: row-level loading state.
    const [busyAccountId, setBusyAccountId] = useState<number | null>(null);
    const measureHeader = useCallback((event: LayoutChangeEvent): void => {
        const height = event.nativeEvent.layout.height;
        if (height <= 0) {
            return;
        }
        setHeaderHeight((previous): number =>
            Math.abs(previous - height) < 0.5 ? previous : height,
        );
    }, []);

    const loadAccounts = useCallback(async (): Promise<void> => {
        const [list, activeId] = await Promise.all([
            getAccounts(),
            getActiveAccountId(),
        ]);
        setAccounts(list);
        setActiveAccountId(activeId);
    }, []);

    // Reload on focus: a switch/add/logout elsewhere must be reflected here.
    useFocusEffect(
        useCallback((): void => {
            void loadAccounts();
        }, [loadAccounts]),
    );

    // Keep the stored avatar/name in sync with the active profile when it
    // loads (accounts start with the phone number, the profile has the name).
    useEffect((): void => {
        if (
            me === null ||
            activeAccountId === null ||
            Number(me.id) !== activeAccountId
        ) {
            return;
        }
        const stored = accounts.find(
            (account) => account.userId === activeAccountId,
        );
        if (stored === undefined) {
            return;
        }
        const username = me.username ?? null;
        const avatarUrl = profile.view.currentAvatarUrl;
        if (
            stored.name === me.name &&
            stored.username === username &&
            stored.avatarUrl === avatarUrl
        ) {
            return;
        }
        void updateAccountProfile(activeAccountId, {
            name: me.name,
            username,
            avatarUrl,
        }).then(loadAccounts);
    }, [
        me,
        accounts,
        activeAccountId,
        profile.view.currentAvatarUrl,
        loadAccounts,
    ]);

    const openAddAccount = (): void => {
        if (accounts.length >= MAX_ACCOUNTS) {
            return;
        }
        router.push({ pathname: '/(auth)/login', params: { mode: 'add' } });
    };

    const handleSwitchAccount = async (account: StoredAccount): Promise<void> => {
        if (busyAccountId !== null || account.userId === activeAccountId) {
            return;
        }
        setBusyAccountId(account.userId);
        const result = await switchAccount(account.userId);
        if (result.ok) {
            setBusyAccountId(null);
            // The switch reset every cache; land on the chat list.
            router.replace('/(app)');
            return;
        }
        setBusyAccountId(null);
        if (result.reason === 'expired') {
            dialog.show({
                title: 'Session expired',
                message: `Sign in again to use ${account.name}.`,
                tone: 'warning',
                buttons: [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Log in again', onPress: openAddAccount },
                ],
            });
            return;
        }
        if (result.reason === 'unavailable') {
            dialog.show({
                title: 'Could not switch account',
                message: 'Check your connection and try again.',
                tone: 'warning',
            });
            return;
        }
        await loadAccounts();
        toast.show('That account is no longer saved.', { tone: 'danger' });
    };

    const handleLogoutAccount = (account: StoredAccount): void => {
        void dialog
            .confirm({
                title: `Log out of ${account.name}?`,
                message:
                    'This removes the saved sign-in for this account. You can log back in at any time.',
                confirmText: 'Log out',
                destructive: true,
            })
            .then(async (confirmed): Promise<void> => {
                if (!confirmed) {
                    return;
                }
                setBusyAccountId(account.userId);
                try {
                    await logoutAccount(account.userId);
                } finally {
                    setBusyAccountId(null);
                    await loadAccounts();
                }
            });
    };

    const rows: readonly SettingsRowConfig[] = [
        { id: 'account', label: 'Account', icon: UserRound },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        {
            id: 'appearance',
            label: 'Appearance',
            icon: Palette,
            onPress: (): void => {
                router.push('/(app)/appearance');
            },
        },
        { id: 'privacy', label: 'Privacy & security', icon: ShieldCheck },
        { id: 'language', label: 'Language', icon: Languages },
        { id: 'about', label: 'About', icon: Info },
    ];

    return (
        <Screen withTopInset={false} withBottomInset={false}>
            {/* Full-bleed like the chats list: the scroll view runs under the
                header and the tab bar, and the fade keeps the first/last row
                fully visible at rest while rows dissolve into the chrome. */}
            <FadingScrollEdges
                edges="both"
                fadeHeight={28}
                topInset={Math.round(headerHeight + spacing.xs)}
                bottomInset={Math.round(tabBarInset)}
            >
                <Animated.ScrollView
                    contentContainerStyle={styles.scroll}
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
                            <SafeText lines={1} style={styles.profileName}>
                                {me?.name ?? 'Your account'}
                            </SafeText>
                            <AppText style={styles.profileHandle} numberOfLines={1}>
                                {me?.username === null || me?.username === undefined
                                    ? 'View profile'
                                    : `@${me.username}`}
                            </AppText>
                        </View>
                        <ChevronRight
                            size={20}
                            color={theme.colors.textMuted}
                            strokeWidth={2}
                        />
                    </Pressable>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <AppText style={styles.sectionTitle}>
                                Accounts
                            </AppText>
                            <AppText style={styles.accountCount}>
                                {accounts.length}/{MAX_ACCOUNTS}
                            </AppText>
                        </View>
                        {accounts.map(
                            (account): React.ReactElement => {
                                const isActive =
                                    account.userId === activeAccountId;
                                const isBusy =
                                    busyAccountId === account.userId;
                                return (
                                    <View
                                        key={account.userId}
                                        style={styles.accountRow}
                                    >
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Switch to ${account.name}`}
                                            accessibilityState={{
                                                selected: isActive,
                                            }}
                                            disabled={
                                                busyAccountId !== null ||
                                                isActive
                                            }
                                            onPress={(): void => {
                                                void handleSwitchAccount(
                                                    account,
                                                );
                                            }}
                                            style={({ pressed }) => [
                                                styles.accountMain,
                                                pressed && styles.cardPressed,
                                            ]}
                                        >
                                            <UserAvatar
                                                userId={account.userId}
                                                name={account.name}
                                                uri={account.avatarUrl}
                                                size={38}
                                            />
                                            <View style={styles.accountBody}>
                                                <SafeText
                                                    lines={1}
                                                    style={styles.accountName}
                                                >
                                                    {account.name}
                                                </SafeText>
                                                <AppText
                                                    style={styles.accountHandle}
                                                    numberOfLines={1}
                                                >
                                                    {account.username === null
                                                        ? 'Saved account'
                                                        : `@${account.username}`}
                                                </AppText>
                                            </View>
                                            {isBusy ? (
                                                <ActivityIndicator
                                                    size="small"
                                                    color={theme.accent}
                                                />
                                            ) : isActive ? (
                                                <Check
                                                    size={20}
                                                    color={theme.accent}
                                                    strokeWidth={2.5}
                                                />
                                            ) : null}
                                        </Pressable>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Log out of ${account.name}`}
                                            disabled={busyAccountId !== null}
                                            onPress={(): void =>
                                                handleLogoutAccount(account)
                                            }
                                            style={({ pressed }) => [
                                                styles.accountLogout,
                                                pressed && styles.cardPressed,
                                            ]}
                                        >
                                            <LogOut
                                                size={18}
                                                color={theme.colors.danger}
                                                strokeWidth={2}
                                            />
                                        </Pressable>
                                    </View>
                                );
                            },
                        )}
                        {accounts.length < MAX_ACCOUNTS && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Add account"
                                disabled={busyAccountId !== null}
                                onPress={openAddAccount}
                                style={({ pressed }) => [
                                    styles.row,
                                    pressed && styles.cardPressed,
                                ]}
                            >
                                <Plus
                                    size={20}
                                    color={theme.accent}
                                    strokeWidth={2}
                                />
                                <AppText style={styles.rowLabel}>
                                    Add account
                                </AppText>
                            </Pressable>
                        )}
                    </View>

                    <View style={styles.section}>
                        {rows.map(
                            (row): React.ReactElement => (
                                <SettingsRow key={row.id} row={row} />
                            ),
                        )}
                    </View>

                    <AppText style={styles.footer}>
                        More settings are on the way. Your chats, profile and
                        privacy controls stay available in the meantime.
                    </AppText>
                </Animated.ScrollView>
            </FadingScrollEdges>

            {/* Transparent chrome over the faded content: the header is not
                masked, so its title/actions stay crisp and tappable. */}
            <View
                pointerEvents="box-none"
                style={[
                    styles.headerLayer,
                    {
                        paddingTop: insets.top + spacing.md,
                        paddingHorizontal: spacing.md,
                    },
                ]}
                onLayout={measureHeader}
            >
                <GlassHeader>
                    <AppText variant="heading">Settings</AppText>
                    <AppText variant="caption">App preferences</AppText>
                </GlassHeader>
            </View>
        </Screen>
    );
}

function SettingsRow({ row }: { row: SettingsRowConfig }): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const Icon = row.icon;
    const enabled = row.onPress !== undefined;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                enabled ? row.label : `${row.label} — coming soon`
            }
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            onPress={row.onPress}
            style={({ pressed }) => [
                styles.row,
                pressed && enabled && styles.cardPressed,
            ]}
        >
            <Icon
                size={20}
                color={
                    enabled
                        ? theme.colors.accent
                        : theme.colors.textSecondary
                }
                strokeWidth={2}
            />
            <AppText style={styles.rowLabel}>{row.label}</AppText>
            {enabled ? (
                <ChevronRight
                    size={18}
                    color={theme.colors.textMuted}
                    strokeWidth={2}
                />
            ) : (
                <View style={styles.soonChip}>
                    <AppText style={styles.soonText}>Soon</AppText>
                </View>
            )}
        </Pressable>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        // Absolute chrome over the full-bleed scroll view (same layer the
        // chats list uses); paddingTop keeps the glass clear of the status bar.
        headerLayer: {
            position: 'absolute',
            top: 0,
            start: 0,
            end: 0,
            gap: spacing.xxs,
        },
        // Horizontal gutter + rhythm stay in the content; the wrapper pads
        // vertically by the header and tab bar heights so it matches the fade.
        scroll: { paddingHorizontal: spacing.md, gap: spacing.md },
        profileCard: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radii.lg,
            backgroundColor: theme.colors.glassAccent,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        cardPressed: { backgroundColor: theme.colors.glassElevated },
        profileBody: { flex: 1, minWidth: 0, gap: 2 },
        profileName: {
            color: theme.colors.text,
            fontSize: 16,
            fontWeight: '700',
        },
        profileHandle: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
        },
        section: {
            borderRadius: radii.lg,
            backgroundColor: theme.colors.glassSurface,
            borderWidth: 1,
            borderColor: theme.colors.border,
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
            borderBottomColor: theme.colors.border,
        },
        rowLabel: {
            flex: 1,
            color: theme.colors.text,
            fontSize: 15,
            fontWeight: '600',
        },
        sectionHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        sectionTitle: {
            color: theme.colors.textMuted,
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
        },
        accountCount: {
            color: theme.colors.textMuted,
            fontSize: 11,
            fontWeight: '600',
        },
        accountRow: {
            flexDirection: 'row',
            alignItems: 'stretch',
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        accountMain: {
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
        },
        accountBody: { flex: 1, minWidth: 0, gap: 2 },
        accountName: {
            color: theme.colors.text,
            fontSize: 15,
            fontWeight: '700',
        },
        accountHandle: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
        },
        accountLogout: {
            width: 52,
            alignItems: 'center',
            justifyContent: 'center',
        },
        soonChip: {
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: radii.full,
            backgroundColor: theme.colors.glassElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        soonText: {
            color: theme.colors.textMuted,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.3,
        },
        footer: {
            color: theme.colors.textMuted,
            fontSize: 12,
            lineHeight: 18,
            textAlign: 'center',
            paddingHorizontal: spacing.lg,
        },
    });
