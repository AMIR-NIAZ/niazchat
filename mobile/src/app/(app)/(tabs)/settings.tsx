import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated from 'react-native-reanimated';
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
import { logout } from '../../../features/auth';
import { useProfile } from '../../../features/users';

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
    const measureHeader = useCallback((event: LayoutChangeEvent): void => {
        const height = event.nativeEvent.layout.height;
        if (height <= 0) {
            return;
        }
        setHeaderHeight((previous): number =>
            Math.abs(previous - height) < 0.5 ? previous : height,
        );
    }, []);

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
                        {rows.map(
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
                                color={theme.colors.danger}
                                strokeWidth={2}
                            />
                            <AppText style={[styles.rowLabel, styles.logoutLabel]}>
                                Log out
                            </AppText>
                        </Pressable>
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
        logoutLabel: { color: theme.colors.danger },
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
