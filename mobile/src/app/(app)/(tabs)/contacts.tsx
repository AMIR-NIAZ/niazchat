import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    SectionList,
    StyleSheet,
    View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import {
    MessageCircle,
    Pencil,
    Trash2,
    User,
    UserPlus,
} from 'lucide-react-native';
import {
    AppText,
    GlassHeader,
    GlassInput,
    OfflineCaption,
    PrimaryButton,
    SafeText,
    Screen,
    UserAvatar,
    radii,
    spacing,
} from '../../../shared/components';
import { useTheme, useThemedStyles } from '../../../shared/theme';
import type { AppTheme } from '../../../shared/theme';
import { useTabBarInset } from '../../../shared/tab-bar';
import { dialog, toast } from '../../../shared/dialog';
import {
    measureInWindow,
    useContextPopup,
    usePopupHidden,
} from '../../../shared/context-popup';
import type {
    ContextMenuItem,
    ViewInstance,
} from '../../../shared/context-popup';
import { openPrivateChat } from '../../../features/chats';
import { openUserProfile } from '../../../features/users/profile-navigation';
import { ApiError } from '../../../core/api';
import {
    buildContactRows,
    buildContactSections,
    contactSubtitle,
    filterContactRows,
} from '../../../features/contacts/contacts-model';
import type {
    ContactRow,
    ContactSection,
} from '../../../features/contacts/contacts-model';
import { useSocketConnectionState } from '../../../core/socket/use-socket';
import { useContactsAccess } from '../../../features/contacts/use-contacts-access';
import type { ContactsAccessApi } from '../../../features/contacts/use-contacts-access';
import { useContactMatches } from '../../../features/contacts/use-contact-matches';
import {
    useAddContact,
    useContacts,
    useRemoveContact,
} from '../../../features/contacts/use-contacts';
import { AddContactSheet } from '../../../features/contacts/add-contact-sheet';
import { RenameContactSheet } from '../../../features/contacts/rename-contact-sheet';
import { describeSavedContactError } from '../../../features/contacts/contacts-api';

/**
 * Contacts tab.
 *
 * Two sources in one alphabetical list:
 * - "My contacts" — people saved inside the app (`/contacts`), shown even
 *   without device permission;
 * - "From your phone" — address-book numbers matched to registered accounts.
 *
 * The address book is read only after the user allows access, on this tab, and
 * the rationale card is always shown BEFORE the OS prompt.
 *
 * Every color comes from the active theme (accent, light/dark) and the canvas
 * stays transparent, so the global app background shows through. Text uses the
 * shared scaled typography, so the chosen font and text size apply live.
 */

const ANIMATED_ROWS = 15;

export default function ContactsScreen(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const tabBarInset = useTabBarInset();
    const queryClient = useQueryClient();
    const popup = useContextPopup();
    const access = useContactsAccess();
    const socketState = useSocketConnectionState();
    const saved = useContacts();
    const device = useContactMatches(access.canRead);
    const addContact = useAddContact();
    const removeContact = useRemoveContact();

    const [search, setSearch] = useState('');
    const [addVisible, setAddVisible] = useState(false);
    const [renameTarget, setRenameTarget] = useState<ContactRow | null>(null);
    const [openingId, setOpeningId] = useState<number | null>(null);

    // Persisted matches are shown even without contact permission (as app
    // names); the saved list always wins for a person present in both.
    const rows = useMemo(
        () => buildContactRows(saved.contacts, device.contacts),
        [saved.contacts, device.contacts],
    );
    const filtered = useMemo(
        () => filterContactRows(rows, search),
        [rows, search],
    );
    const sections = useMemo(() => buildContactSections(filtered), [filtered]);

    const savedCount = useMemo(
        () => rows.filter((row) => row.saved).length,
        [rows],
    );
    // Only a screen with NOTHING to show gets a loading state.
    const isLoading =
        rows.length === 0 && (saved.isLoading || device.isLoading);
    const isRefreshing = saved.isRefreshing || device.isRefreshing;
    const error = saved.error
        ? describeSavedContactError(saved.error)
        : device.error;
    const searching = search.trim() !== '';

    const refresh = useCallback((): void => {
        if (socketState === 'disconnected') {
            // Never start a pointless request (and never clear the list) while
            // offline: the already-rendered rows stay exactly as they are.
            toast.show("You're offline");
            return;
        }
        saved.refetch();
        if (access.canRead) {
            device.refresh();
        }
    }, [saved, device, access.canRead, socketState]);

    const openChat = useCallback(
        async (row: ContactRow): Promise<void> => {
            if (openingId !== null) {
                return;
            }
            setOpeningId(row.userId);
            try {
                await openPrivateChat(row.userId, { queryClient });
            } catch (failure) {
                dialog.show({
                    title: 'Could not open chat',
                    message:
                        failure instanceof Error
                            ? failure.message
                            : 'Try again in a moment.',
                    tone: 'danger',
                });
            } finally {
                setOpeningId(null);
            }
        },
        [openingId, queryClient],
    );

    const addRowToContacts = useCallback(
        async (row: ContactRow): Promise<void> => {
            try {
                await addContact.mutateAsync({
                    userId: row.userId,
                    preview: {
                        userId: row.userId,
                        name: row.appName,
                        username: row.username,
                        avatarUrl: row.avatarUrl,
                    },
                });
                toast.show('Added to contacts', { tone: 'success' });
            } catch (failure) {
                if (failure instanceof ApiError && failure.statusCode === 409) {
                    toast.show('Already in your contacts');
                    return;
                }
                dialog.show({
                    title: 'Could not add contact',
                    message: describeSavedContactError(failure),
                    tone: 'danger',
                });
            }
        },
        [addContact],
    );

    const confirmRemove = useCallback(
        async (row: ContactRow): Promise<void> => {
            if (row.savedContactId === null) {
                return;
            }
            const confirmed = await dialog.confirm({
                title: 'Remove contact?',
                message: `${row.displayName} will be removed from your saved contacts.`,
                confirmText: 'Remove',
                destructive: true,
            });
            if (!confirmed) {
                return;
            }
            try {
                await removeContact.mutateAsync(row.savedContactId);
                toast.show('Contact removed');
            } catch (failure) {
                dialog.show({
                    title: 'Could not remove contact',
                    message: describeSavedContactError(failure),
                    tone: 'danger',
                });
            }
        },
        [removeContact],
    );

    const handleRowPress = useCallback(
        (row: ContactRow): void => {
            void openChat(row);
        },
        [openChat],
    );

    const openRowMenu = useCallback(
        (
            row: ContactRow,
            anchor: { x: number; y: number; width: number; height: number },
        ): void => {
            const actions: ContextMenuItem[] = [
                {
                    id: 'message',
                    label: 'Message',
                    icon: MessageCircle,
                    onPress: (): void => {
                        void openChat(row);
                    },
                },
            ];
            if (!row.saved) {
                actions.push({
                    id: 'add',
                    label: 'Add to contacts',
                    icon: UserPlus,
                    onPress: (): void => {
                        void addRowToContacts(row);
                    },
                });
            }
            if (row.saved) {
                actions.push({
                    id: 'rename',
                    label: 'Rename',
                    icon: Pencil,
                    onPress: (): void => setRenameTarget(row),
                });
            }
            actions.push({
                id: 'profile',
                label: 'View profile',
                icon: User,
                onPress: (): void => {
                    openUserProfile({
                        userId: row.userId,
                        name: row.appName,
                        avatar: row.avatarUrl,
                    });
                },
            });
            if (row.saved) {
                actions.push({
                    id: 'remove',
                    label: 'Remove contact',
                    icon: Trash2,
                    destructive: true,
                    onPress: (): void => {
                        void confirmRemove(row);
                    },
                });
            }
            popup.open({
                anchor,
                align: 'start',
                sourceKey: row.key,
                actions,
                accessibilityLabel: 'Contact actions',
            });
        },
        [popup, openChat, addRowToContacts, confirmRemove],
    );

    const showEmpty = !isLoading && filtered.length === 0;
    // Offline failures are already covered by the caption; a banner would
    // read as an error state over perfectly good saved rows.
    const showErrorBanner =
        error !== null && rows.length > 0 && socketState !== 'disconnected';

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <GlassHeader
                layout="row"
                trailing={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add contact"
                        onPress={(): void => setAddVisible(true)}
                        style={({ pressed }) => [
                            styles.addButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <AppText
                            style={styles.addGlyph}
                            allowFontScaling={false}
                        >
                            ＋
                        </AppText>
                        <SafeText style={styles.addText}>Add contact</SafeText>
                    </Pressable>
                }
            >
                <AppText variant="heading">Contacts</AppText>
            </GlassHeader>

            <GlassInput
                placeholder="Search contacts"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search contacts"
                leading={
                    <AppText
                        style={styles.searchGlyph}
                        allowFontScaling={false}
                    >
                        ⌕
                    </AppText>
                }
            />

            <PermissionCard access={access} />

            {rows.length > 0 && (
                <>
                    <AppText variant="caption" style={styles.counts}>
                        On the app · {rows.length}
                        {savedCount > 0 ? ` · ${savedCount} saved` : ''}
                    </AppText>
                    <OfflineCaption />
                </>
            )}

            {showErrorBanner && (
                <View style={styles.errorBanner}>
                    <AppText style={styles.errorBannerText}>{error}</AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading contacts"
                        onPress={refresh}
                        style={({ pressed }) => [
                            styles.retrySmall,
                            pressed && styles.pressed,
                        ]}
                    >
                        <AppText style={styles.linkText}>Retry</AppText>
                    </Pressable>
                </View>
            )}

            {isLoading ? (
                <SkeletonRows />
            ) : showEmpty ? (
                <EmptyState
                    searching={searching}
                    access={access}
                    onAdd={(): void => setAddVisible(true)}
                    error={rows.length === 0 ? error : null}
                    onRetry={refresh}
                />
            ) : (
                <SectionList<ContactRow, ContactSection>
                    style={styles.list}
                    sections={sections}
                    keyExtractor={(item): string => item.key}
                    stickySectionHeadersEnabled={true}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{
                        paddingBottom: tabBarInset,
                        paddingTop: spacing.xxs,
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={refresh}
                            tintColor={theme.accent}
                            colors={[theme.accent]}
                        />
                    }
                    renderSectionHeader={({ section }): React.ReactElement => (
                        <View style={styles.sectionHeader}>
                            <AppText style={styles.sectionTitle}>
                                {section.title}
                            </AppText>
                        </View>
                    )}
                    renderItem={({ item, index }): React.ReactElement => (
                        <ContactRowView
                            row={item}
                            index={index}
                            opening={openingId === item.userId}
                            onPress={handleRowPress}
                            onOpenMenu={openRowMenu}
                        />
                    )}
                    ListFooterComponent={
                        <View style={styles.footer}>
                            {access.state === 'notNow' && (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Allow contacts access"
                                    onPress={access.allow}
                                    style={({ pressed }) => [
                                        styles.allowRow,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <AppText style={styles.linkText}>
                                        Allow contacts access
                                    </AppText>
                                </Pressable>
                            )}
                            {access.state === 'limited' && (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Manage contacts access"
                                    onPress={access.openSettings}
                                    style={({ pressed }) => [
                                        styles.allowRow,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <AppText style={styles.linkText}>
                                        Manage access
                                    </AppText>
                                </Pressable>
                            )}
                        </View>
                    }
                />
            )}

            <AddContactSheet
                visible={addVisible}
                onClose={(): void => setAddVisible(false)}
            />
            <RenameContactSheet
                visible={renameTarget !== null}
                contactId={renameTarget?.savedContactId ?? null}
                currentName={renameTarget?.displayName ?? ''}
                initialAlias={
                    renameTarget === null
                        ? null
                        : (saved.contacts.find(
                              (contact) =>
                                  contact.id === renameTarget.savedContactId,
                          )?.alias ?? null)
                }
                onClose={(): void => setRenameTarget(null)}
            />
        </Screen>
    );
}

// ── Permission ──────────────────────────────────────────────────────────────

function PermissionCard({
    access,
}: {
    access: ContactsAccessApi;
}): React.ReactElement | null {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    if (access.state === 'granted' || access.state === 'limited') {
        return null;
    }
    if (access.state === 'checking' || access.state === 'notNow') {
        return null;
    }
    const blocked = access.state === 'blocked';
    const requesting = access.state === 'requesting';

    return (
        <View style={styles.permissionCard}>
            <View style={styles.permissionIcon}>
                <AppText style={styles.permissionIconText} allowFontScaling={false}>
                    👥
                </AppText>
            </View>
            <AppText variant="body" style={styles.permissionTitle}>
                Find your friends
            </AppText>
            <AppText variant="caption" style={styles.permissionText}>
                Allow access to your contacts to see which of them are already
                on the app. Matching accounts are saved on this device; your
                address book is never uploaded.
            </AppText>
            {blocked ? (
                <View style={styles.permissionActions}>
                    <PrimaryButton
                        label="Open settings"
                        onPress={access.openSettings}
                        variant="primary"
                        fullWidth={false}
                    />
                </View>
            ) : (
                <View style={styles.permissionActions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Allow access to contacts"
                        accessibilityState={{
                            disabled: requesting,
                            busy: requesting,
                        }}
                        disabled={requesting}
                        onPress={access.allow}
                        style={({ pressed }) => [
                            styles.allowButton,
                            pressed && styles.pressed,
                            requesting && styles.disabled,
                        ]}
                    >
                        {requesting ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.accentText}
                            />
                        ) : (
                            <SafeText style={styles.allowButtonText}>
                                Allow access
                            </SafeText>
                        )}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Not now"
                        disabled={requesting}
                        onPress={access.notNow}
                        style={({ pressed }) => [
                            styles.notNowButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <SafeText style={styles.notNowText}>Not now</SafeText>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
    searching,
    access,
    onAdd,
    error,
    onRetry,
}: {
    searching: boolean;
    access: ContactsAccessApi;
    onAdd: () => void;
    error: string | null;
    onRetry: () => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    if (error !== null) {
        return (
            <View style={styles.center}>
                <AppText variant="title">Could not load contacts</AppText>
                <AppText variant="caption" style={styles.detail}>
                    {error}
                </AppText>
                <PrimaryButton
                    label="Retry"
                    onPress={onRetry}
                    fullWidth={false}
                />
            </View>
        );
    }
    if (searching) {
        return (
            <View style={styles.center}>
                <AppText variant="title">No contacts found</AppText>
                <AppText variant="caption" style={styles.detail}>
                    Try a different name or username.
                </AppText>
            </View>
        );
    }
    return (
        <View style={styles.center}>
            <View style={styles.emptyIcon}>
                <AppText style={styles.emptyIconText} allowFontScaling={false}>
                    👤
                </AppText>
            </View>
            <AppText variant="title">No contacts yet</AppText>
            <AppText variant="caption" style={styles.detail}>
                Add someone by phone number, or let the app find friends
                from your phone's contacts.
            </AppText>
            <PrimaryButton
                label="Add contact"
                onPress={onAdd}
                fullWidth={false}
            />
            {(access.state === 'rationale' ||
                access.state === 'denied' ||
                access.state === 'notNow') && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Allow contacts access"
                    onPress={access.allow}
                    style={({ pressed }) => [
                        styles.allowRow,
                        pressed && styles.pressed,
                    ]}
                >
                    <AppText style={styles.linkText}>
                        Allow contacts access
                    </AppText>
                </Pressable>
            )}
            {access.state === 'blocked' && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open settings"
                    onPress={access.openSettings}
                    style={({ pressed }) => [
                        styles.allowRow,
                        pressed && styles.pressed,
                    ]}
                >
                    <AppText style={styles.linkText}>Open settings</AppText>
                </Pressable>
            )}
        </View>
    );
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface ContactRowViewProps {
    row: ContactRow;
    index: number;
    opening: boolean;
    onPress: (row: ContactRow) => void;
    onOpenMenu: (
        row: ContactRow,
        anchor: { x: number; y: number; width: number; height: number },
    ) => void;
}

/**
 * Memoized row: it reads the theme itself (`useTheme`/`useThemedStyles`), so a
 * theme, accent, font or text-size change repaints it without relying on the
 * list's `extraData`. Props only carry data and stable callbacks.
 */
const ContactRowView = memo(function ContactRowView({
    row,
    index,
    opening,
    onPress,
    onOpenMenu,
}: ContactRowViewProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const hidden = usePopupHidden(row.key);
    const ref = useRef<ViewInstance | null>(null);
    const subtitle = contactSubtitle(row);
    const entering = index < ANIMATED_ROWS ? FadeIn.duration(150) : null;

    const handleLongPress = (): void => {
        void measureInWindow(ref).then((anchor): void => {
            if (anchor !== null) {
                onOpenMenu(row, anchor);
            }
        });
    };

    return (
        <Animated.View
            {...(entering !== null ? { entering } : {})}
            style={hidden}
        >
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={`Message ${row.displayName}`}
                accessibilityState={{ busy: opening }}
                onPress={(): void => onPress(row)}
                onLongPress={handleLongPress}
                delayLongPress={350}
                style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                ]}
            >
                <UserAvatar
                    userId={row.userId}
                    name={row.displayName}
                    uri={row.avatarUrl}
                    size={46}
                />
                <View style={styles.rowBody}>
                    <SafeText
                        style={[theme.type.chatTitle, styles.rowName]}
                        lines={1}
                    >
                        {row.displayName}
                    </SafeText>
                    {subtitle !== null && (
                        <SafeText
                            style={[theme.type.chatPreview, styles.rowSubtitle]}
                            lines={1}
                        >
                            {subtitle}
                        </SafeText>
                    )}
                </View>
                {row.saved && (
                    <View style={styles.badge}>
                        <SafeText style={styles.badgeText}>Saved</SafeText>
                    </View>
                )}
                {opening ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                ) : null}
            </Pressable>
        </Animated.View>
    );
});

// ── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRows(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.skeletonList} accessibilityLabel="Loading contacts">
            {[0, 1, 2, 3, 4, 5].map(
                (key): React.ReactElement => (
                    <View key={key} style={styles.skeletonRow}>
                        <View style={styles.skeletonAvatar} />
                        <View style={styles.skeletonBody}>
                            <View style={styles.skeletonName} />
                            <View style={styles.skeletonHandle} />
                        </View>
                    </View>
                ),
            )}
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        // Transparent canvas: the app background layer (solid, gradient,
        // circles or an image) is the only thing painted behind the screen.
        screen: {
            paddingHorizontal: spacing.md,
            gap: spacing.sm,
        },
        searchGlyph: { color: theme.colors.textMuted, fontSize: 20 },
        pressed: { opacity: 0.6 },
        disabled: { opacity: 0.6 },
        addButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xxs,
            paddingHorizontal: spacing.sm,
            paddingVertical: 6,
            borderRadius: radii.full,
            backgroundColor: theme.accent,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
        },
        addGlyph: {
            color: theme.colors.accentText,
            fontSize: 14,
            fontWeight: '700',
        },
        addText: {
            ...theme.type.label,
            fontSize: 12,
            color: theme.colors.accentText,
        },
        counts: { color: theme.colors.textMuted },
        list: { flex: 1 },
        permissionCard: {
            alignItems: 'center',
            gap: spacing.xxs,
            padding: spacing.md,
            borderRadius: radii.lg,
            backgroundColor: theme.colors.glassAccent,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
        },
        permissionIcon: {
            width: 44,
            height: 44,
            borderRadius: radii.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.accentSoft,
        },
        permissionIconText: { fontSize: 22 },
        permissionTitle: {
            color: theme.colors.text,
            textAlign: 'center',
        },
        permissionText: {
            color: theme.colors.textSecondary,
            textAlign: 'center',
        },
        permissionActions: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            marginTop: spacing.xxs,
        },
        allowButton: {
            minWidth: 128,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.accent,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
        },
        allowButtonText: {
            ...theme.type.label,
            fontSize: 14,
            color: theme.colors.accentText,
        },
        notNowButton: {
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
        },
        notNowText: {
            ...theme.type.label,
            color: theme.colors.textSecondary,
        },
        // Sticky header: semi-transparent theme surface so it stays readable
        // over any background while rows scroll beneath it.
        sectionHeader: {
            backgroundColor: theme.colors.glassHeader,
            paddingVertical: spacing.xxs,
            paddingHorizontal: spacing.xxs,
            borderRadius: radii.sm,
        },
        sectionTitle: {
            ...theme.type.micro,
            fontSize: 12,
            letterSpacing: 0.5,
            color: theme.accent,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.xxs,
            borderRadius: radii.md,
            // Readable base over a photo/gradient app background.
            backgroundColor: theme.colors.glassSurface,
        },
        rowPressed: { backgroundColor: theme.colors.glassElevated },
        rowBody: { flex: 1, minWidth: 0, gap: 2 },
        rowName: { color: theme.colors.text },
        rowSubtitle: { color: theme.colors.textSecondary },
        badge: {
            flexShrink: 0,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: radii.full,
            backgroundColor: theme.colors.accentSoft,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
        },
        badgeText: {
            ...theme.type.micro,
            color: theme.accent,
        },
        footer: { paddingTop: spacing.sm, alignItems: 'center' },
        allowRow: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
        linkText: {
            ...theme.type.label,
            color: theme.accent,
        },
        center: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.lg,
        },
        detail: {
            textAlign: 'center',
            color: theme.colors.textSecondary,
        },
        emptyIcon: {
            width: 64,
            height: 64,
            borderRadius: radii.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.accentSoft,
        },
        emptyIconText: { fontSize: 30 },
        errorBanner: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.sm,
            padding: spacing.xs,
            borderRadius: radii.md,
            backgroundColor: theme.colors.glassElevated,
            borderWidth: 1,
            borderColor: theme.colors.border,
        },
        errorBannerText: {
            ...theme.type.caption,
            flex: 1,
            color: theme.colors.danger,
        },
        retrySmall: { padding: spacing.xxs },
        skeletonList: { gap: spacing.sm, paddingTop: spacing.xs },
        skeletonRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.xs,
        },
        skeletonAvatar: {
            width: 46,
            height: 46,
            borderRadius: 23,
            backgroundColor: theme.colors.glassElevated,
        },
        skeletonBody: { flex: 1, gap: 8 },
        skeletonName: {
            width: '45%',
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.colors.glassElevated,
        },
        skeletonHandle: {
            width: '30%',
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.colors.glassElevated,
        },
    });
