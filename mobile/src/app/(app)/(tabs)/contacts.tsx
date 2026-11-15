import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    SectionList,
    StyleSheet,
    Text,
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
    PrimaryButton,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
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
 */

const ANIMATED_ROWS = 15;

export default function ContactsScreen(): React.ReactElement {
    const tabBarInset = useTabBarInset();
    const queryClient = useQueryClient();
    const popup = useContextPopup();
    const access = useContactsAccess();
    const saved = useContacts();
    const device = useContactMatches(access.canRead);
    const addContact = useAddContact();
    const removeContact = useRemoveContact();

    const [search, setSearch] = useState('');
    const [addVisible, setAddVisible] = useState(false);
    const [renameTarget, setRenameTarget] = useState<ContactRow | null>(null);
    const [openingId, setOpeningId] = useState<number | null>(null);

    const rows = useMemo(
        () =>
            buildContactRows(
                saved.contacts,
                access.canRead ? device.contacts : [],
            ),
        [saved.contacts, device.contacts, access.canRead],
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
    const isLoading =
        saved.isLoading ||
        (access.canRead && device.isLoading && rows.length === 0);
    const isRefreshing = saved.isRefreshing || device.isRefreshing;
    const error = saved.error
        ? describeSavedContactError(saved.error)
        : access.canRead
          ? device.error
          : null;
    const searching = search.trim() !== '';

    const refresh = useCallback((): void => {
        saved.refetch();
        if (access.canRead) {
            device.refresh();
        }
    }, [saved, device, access.canRead]);

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
                        <Text style={styles.addGlyph}>＋</Text>
                        <Text style={styles.addText}>Add contact</Text>
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
                leading={<Text style={styles.searchGlyph}>⌕</Text>}
            />

            <PermissionCard access={access} />

            {rows.length > 0 && (
                <AppText variant="caption" style={styles.counts}>
                    On the app · {rows.length}
                    {savedCount > 0 ? ` · ${savedCount} saved` : ''}
                </AppText>
            )}

            {error !== null && rows.length > 0 && (
                <View style={styles.errorBanner}>
                    <Text style={styles.errorBannerText}>{error}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading contacts"
                        onPress={refresh}
                        style={({ pressed }) => [
                            styles.retrySmall,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={styles.linkText}>Retry</Text>
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
                            tintColor={palette.primary[300]}
                            colors={[palette.primary[500]]}
                        />
                    }
                    renderSectionHeader={({ section }): React.ReactElement => (
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>
                                {section.title}
                            </Text>
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
                                    <Text style={styles.linkText}>
                                        Allow contacts access
                                    </Text>
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
                                    <Text style={styles.linkText}>
                                        Manage access
                                    </Text>
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
                <Text style={styles.permissionIconText}>👥</Text>
            </View>
            <Text style={styles.permissionTitle}>Find your friends</Text>
            <Text style={styles.permissionText}>
                Allow access to your contacts to see which of them are already
                on the app. Contacts are matched on request and never stored.
            </Text>
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
                                color={palette.text.onAccent}
                            />
                        ) : (
                            <Text style={styles.allowButtonText}>
                                Allow access
                            </Text>
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
                        <Text style={styles.notNowText}>Not now</Text>
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
    if (error !== null) {
        return (
            <View style={styles.center}>
                <AppText variant="title">Could not load contacts</AppText>
                <AppText style={styles.detail}>{error}</AppText>
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
                <AppText style={styles.detail}>
                    Try a different name or username.
                </AppText>
            </View>
        );
    }
    return (
        <View style={styles.center}>
            <View style={styles.emptyIcon}>
                <Text style={styles.emptyIconText}>👤</Text>
            </View>
            <AppText variant="title">No contacts yet</AppText>
            <AppText style={styles.detail}>
                Add someone by phone or username, or let the app find friends
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
                    <Text style={styles.linkText}>Allow contacts access</Text>
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
                    <Text style={styles.linkText}>Open settings</Text>
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

const ContactRowView = memo(function ContactRowView({
    row,
    index,
    opening,
    onPress,
    onOpenMenu,
}: ContactRowViewProps): React.ReactElement {
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
                    <Text style={typography.body} numberOfLines={1}>
                        {row.displayName}
                    </Text>
                    {subtitle !== null && (
                        <Text style={typography.caption} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    )}
                </View>
                {row.saved && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>Saved</Text>
                    </View>
                )}
                {opening ? (
                    <ActivityIndicator
                        size="small"
                        color={palette.primary[300]}
                    />
                ) : null}
            </Pressable>
        </Animated.View>
    );
});

// ── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRows(): React.ReactElement {
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

const styles = StyleSheet.create({
    screen: { paddingHorizontal: spacing.md, gap: spacing.sm },
    searchGlyph: { color: palette.text.muted, fontSize: 20 },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.6 },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: radii.full,
        backgroundColor: palette.primary[500],
    },
    addGlyph: { color: palette.text.onAccent, fontSize: 14, fontWeight: '700' },
    addText: {
        color: palette.text.onAccent,
        fontSize: 12,
        fontWeight: '700',
    },
    counts: { color: palette.text.muted },
    list: { flex: 1 },
    permissionCard: {
        alignItems: 'center',
        gap: spacing.xxs,
        padding: spacing.md,
        borderRadius: radii.lg,
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.accent,
    },
    permissionIcon: {
        width: 44,
        height: 44,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    permissionIconText: { fontSize: 22 },
    permissionTitle: {
        color: palette.text.primary,
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
    },
    permissionText: {
        color: palette.text.secondary,
        fontSize: 12,
        lineHeight: 18,
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
        backgroundColor: palette.primary[500],
        borderRadius: radii.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
    },
    allowButtonText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '700',
    },
    notNowButton: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border.strong,
    },
    notNowText: {
        color: palette.text.secondary,
        fontSize: 13,
        fontWeight: '600',
    },
    sectionHeader: {
        backgroundColor: palette.background,
        paddingVertical: spacing.xxs,
        paddingHorizontal: spacing.xxs,
    },
    sectionTitle: {
        color: palette.primary[600],
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xxs,
        borderRadius: radii.md,
    },
    rowPressed: { backgroundColor: palette.glass.elevated },
    rowBody: { flex: 1, gap: 2 },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radii.full,
        backgroundColor: palette.primary[100],
        borderWidth: 1,
        borderColor: palette.border.accent,
    },
    badgeText: {
        color: palette.primary[700],
        fontSize: 10,
        fontWeight: '700',
    },
    footer: { paddingTop: spacing.sm, alignItems: 'center' },
    allowRow: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
    linkText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.lg,
    },
    detail: { textAlign: 'center', color: palette.text.secondary },
    emptyIcon: {
        width: 64,
        height: 64,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    emptyIconText: { fontSize: 30 },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        padding: spacing.xs,
        borderRadius: radii.md,
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    errorBannerText: {
        flex: 1,
        color: palette.semantic.danger,
        fontSize: 12,
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
        backgroundColor: palette.glass.elevated,
    },
    skeletonBody: { flex: 1, gap: 8 },
    skeletonName: {
        width: '45%',
        height: 12,
        borderRadius: 6,
        backgroundColor: palette.glass.elevated,
    },
    skeletonHandle: {
        width: '30%',
        height: 10,
        borderRadius: 5,
        backgroundColor: palette.glass.elevated,
    },
});
