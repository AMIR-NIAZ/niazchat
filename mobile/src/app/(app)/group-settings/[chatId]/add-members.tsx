import { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
    AppText,
    SafeText,
    UserAvatar,
    radii,
    spacing,
} from '../../../../shared/components';
import { dialog, toast } from '../../../../shared/dialog';
import { ApiError } from '../../../../core/api';
import { useContacts } from '../../../../features/contacts/use-contacts';
import {
    addMembersFeedback,
    buildAddContactOptions,
    chunkUserIds,
    failuresText,
    filterAddContactOptions,
    mergeAddMembersResults,
    selectedCountLabel,
    toggleContactSelection,
} from '../../../../features/groups/add-members-model';
import type { AddContactOption } from '../../../../features/groups/add-members-model';
import type {
    AddMemberFailure,
    AddMembersResult,
} from '../../../../features/groups/group-model';
import {
    useAddGroupMembers,
    useGroupInfo,
    useGroupMemberIdSet,
} from '../../../../features/groups/use-group';
import { openUserProfile } from '../../../../features/users/profile-navigation';
import { Check, Contact, Search } from 'lucide-react-native';
import { useTheme, useThemedStyles } from '../../../../shared/theme';
import type { AppTheme } from '../../../../shared/theme';

/**
 * Add members (`/group-settings/:chatId/add-members`).
 *
 * One path: saved NiazChat contacts (`GET /contacts`) — never the device
 * address book, no permission prompt.
 *
 * The server remains the authority: the screen only renders
 * `capabilities.canAddMembers`, then sends `POST /chats/:chatId/members`.
 * Per-user rejections come back as `failed` and are reported explicitly while
 * the accepted users stay added (partial success).
 *
 * Each row shows the contact's public User ID. Tapping it opens that user's
 * profile; a contact without a public ID gets a short floating hint instead.
 */

type AddMembersRouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function AddMembersScreen(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const params = useLocalSearchParams<AddMembersRouteParams>();
    const chatId = parseChatId(params.chatId);

    if (chatId === null) {
        return (
            <View style={styles.root}>
                <TopBar />
                <StateBlock
                    title="Add members"
                    detail="This link is not valid."
                />
            </View>
        );
    }
    return <AddMembers chatId={chatId} />;
}

function AddMembers({ chatId }: { chatId: number }): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const infoQuery = useGroupInfo(chatId);
    const info = infoQuery.data;
    const allowed = info?.capabilities.canAddMembers === true;
    const addMutation = useAddGroupMembers(chatId);

    /** Users this screen already added (immediate duplicate prevention). */
    const [addedUserIds, setAddedUserIds] = useState<ReadonlySet<number>>(
        new Set(),
    );

    const markAdded = useCallback((result: AddMembersResult): void => {
        if (result.added.length === 0) return;
        setAddedUserIds((current) => {
            const next = new Set(current);
            for (const member of result.added) next.add(member.userId);
            return next;
        });
    }, []);

    if (infoQuery.isPending && info === undefined) {
        return (
            <View style={styles.root}>
                <TopBar />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={theme.accent}
                    />
                    <AppText style={styles.caption}>Loading group…</AppText>
                </View>
            </View>
        );
    }

    if (infoQuery.isError || info === undefined) {
        return (
            <View style={styles.root}>
                <TopBar />
                <StateBlock
                    title="Add members unavailable"
                    detail={describeInfoError(infoQuery.error)}
                    onRetry={(): void => {
                        void infoQuery.refetch();
                    }}
                />
            </View>
        );
    }

    if (!allowed) {
        return (
            <View style={styles.root}>
                <TopBar />
                <StateBlock
                    title="Add members"
                    detail="You don't have permission to add members to this group."
                />
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <TopBar />
            <ContactsPicker
                chatId={chatId}
                addedUserIds={addedUserIds}
                busy={addMutation.isPending}
                onAdded={markAdded}
                onSubmit={(userIds): Promise<AddMembersResult> =>
                    addMutation.mutateAsync(userIds)
                }
            />
        </View>
    );
}

// ── Contacts ───────────────────────────────────────────────────────────────

function ContactsPicker(props: {
    chatId: number;
    addedUserIds: ReadonlySet<number>;
    busy: boolean;
    onAdded: (result: AddMembersResult) => void;
    onSubmit: (userIds: number[]) => Promise<AddMembersResult>;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const contactsQuery = useContacts();
    const memberIdsQuery = useGroupMemberIdSet(props.chatId);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
    const [submitting, setSubmitting] = useState(false);

    const memberIds = useMemo(() => {
        const merged = new Set<number>(memberIdsQuery.data ?? []);
        for (const userId of props.addedUserIds) merged.add(userId);
        return merged;
    }, [memberIdsQuery.data, props.addedUserIds]);

    const options = useMemo(
        () => buildAddContactOptions(contactsQuery.contacts, memberIds),
        [contactsQuery.contacts, memberIds],
    );
    const visible = useMemo(
        () => filterAddContactOptions(options, search),
        [options, search],
    );
    const selectedCount = selected.size;

    const toggle = (option: AddContactOption): void => {
        if (option.isMember || props.busy || submitting) return;
        setSelected((current) =>
            toggleContactSelection(current, option.userId),
        );
    };

    const runAdd = (): void => {
        if (selectedCount === 0 || props.busy || submitting) return;
        const batches = chunkUserIds([...selected]);
        setSubmitting(true);
        const results: AddMembersResult[] = [];
        const apply = (): void => {
            const merged = mergeAddMembersResults(results);
            if (merged.added.length === 0 && merged.failed.length === 0) return;
            setSelected((current) => {
                const next = new Set(current);
                for (const member of merged.added) next.delete(member.userId);
                return next;
            });
            props.onAdded(merged);
            if (merged.failed.length > 0 && merged.added.length > 0) {
                toast.show(addMembersFeedback(merged), { tone: 'warning' });
                dialog.show({
                    title: 'Some people were not added',
                    message: failuresText(merged.failed),
                    tone: 'warning',
                });
            } else if (merged.failed.length > 0) {
                dialog.show({
                    title: 'Nobody could be added',
                    message: failuresText(merged.failed),
                    tone: 'danger',
                });
            } else {
                reportResult(merged);
            }
        };
        void (async (): Promise<void> => {
            try {
                for (const batch of batches) {
                    results.push(await props.onSubmit(batch));
                }
            } catch (error) {
                // Keep the batches that already committed (partial success)
                // visible even when a later one failed.
                apply();
                throw error;
            }
            apply();
        })()
            .catch((error: unknown): void => {
                toast.show(describeAddError(error), { tone: 'danger' });
            })
            .finally((): void => setSubmitting(false));
    };

    const loading = contactsQuery.isLoading || memberIdsQuery.isPending;
    const loadError =
        contactsQuery.error !== null
            ? contactsQuery.error.message
            : memberIdsQuery.isError
              ? 'Could not load the current members.'
              : null;

    const renderRow = ({
        item,
    }: ListRenderItemInfo<AddContactOption>): React.ReactElement => (
        <ContactRow
            option={item}
            selected={selected.has(item.userId)}
            disabled={props.busy || submitting}
            onPress={(): void => toggle(item)}
        />
    );

    return (
        <View style={styles.contactsRoot}>
            <View style={styles.searchRow}>
                <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search contacts"
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Search contacts"
                    style={styles.input}
                />
                <View style={styles.searchIcon}>
                    <Search
                        size={18}
                        color={theme.accent}
                        strokeWidth={2}
                    />
                </View>
            </View>

            <FlatList
                data={visible}
                keyExtractor={(item): string => `contact-${item.userId}`}
                renderItem={renderRow}
                contentContainerStyle={styles.contactsList}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                    loading ? (
                        <View style={styles.stateCard}>
                            <ActivityIndicator
                                size="small"
                                color={theme.accent}
                            />
                            <AppText style={styles.stateDetail}>
                                Loading contacts…
                            </AppText>
                        </View>
                    ) : loadError !== null ? (
                        <View style={styles.stateCard}>
                            <AppText style={styles.stateTitle}>
                                Could not load contacts
                            </AppText>
                            <AppText style={styles.stateDetail}>{loadError}</AppText>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading contacts"
                                style={styles.retryButton}
                                onPress={(): void => {
                                    contactsQuery.refetch();
                                    void memberIdsQuery.refetch();
                                }}
                            >
                                <AppText style={styles.retryText}>Retry</AppText>
                            </Pressable>
                        </View>
                    ) : contactsQuery.contacts.length === 0 ? (
                        <View style={styles.stateCard}>
                            <Contact
                                size={26}
                                color={theme.accent}
                                strokeWidth={1.8}
                            />
                            <AppText style={styles.stateTitle}>
                                No saved contacts yet
                            </AppText>
                            <AppText style={styles.stateDetail}>
                                Add people in the Contacts tab first, then come
                                back here.
                            </AppText>
                        </View>
                    ) : (
                        <View style={styles.stateCard}>
                            <AppText style={styles.stateTitle}>
                                No contacts found
                            </AppText>
                            <AppText style={styles.stateDetail}>
                                Try another name or username.
                            </AppText>
                        </View>
                    )
                }
            />

            <View style={styles.footer}>
                <AppText style={styles.selectionLabel}>
                    {selectedCountLabel(selectedCount) ??
                        'Select people to add'}
                </AppText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        selectedCount > 0
                            ? `Add ${selectedCount} selected contacts`
                            : 'Add selected contacts'
                    }
                    accessibilityState={{
                        disabled:
                            selectedCount === 0 || props.busy || submitting,
                    }}
                    disabled={selectedCount === 0 || props.busy || submitting}
                    style={({ pressed }) => [
                        styles.primaryButton,
                        (selectedCount === 0 || props.busy || submitting) &&
                            styles.primaryButtonDisabled,
                        pressed && styles.primaryButtonPressed,
                    ]}
                    onPress={runAdd}
                >
                    {submitting || props.busy ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.accentText}
                        />
                    ) : (
                        <AppText style={styles.primaryButtonText}>
                            {selectedCount > 0 ? `Add ${selectedCount}` : 'Add'}
                        </AppText>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

// ── shared rows ────────────────────────────────────────────────────────────

function ContactRow(props: {
    option: AddContactOption;
    selected: boolean;
    disabled: boolean;
    onPress: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const { option } = props;
    const isDisabled = option.isMember || props.disabled;

    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{
                checked: props.selected,
                disabled: isDisabled,
            }}
            accessibilityLabel={`${option.displayName}${
                option.isMember ? ', already in the group' : ''
            }`}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.contactRow,
                pressed && !isDisabled && styles.contactRowPressed,
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open profile of ${option.displayName}`}
                hitSlop={4}
                onPress={(): void => {
                    openUserProfile({
                        userId: option.userId,
                        name: option.displayName,
                        avatar: option.avatarUrl,
                    });
                }}
            >
                <UserAvatar
                    userId={option.userId}
                    name={option.displayName}
                    uri={option.avatarUrl}
                    size={44}
                />
            </Pressable>
            <View style={styles.rowBody}>
                <SafeText
                    style={[
                        styles.rowName,
                        option.isMember && styles.rowNameMuted,
                    ]}
                    lines={1}
                >
                    {option.displayName}
                </SafeText>
                {option.username !== null && option.username !== '' && (
                    <AppText style={styles.rowMeta} numberOfLines={1}>
                        @{option.username}
                    </AppText>
                )}
                {option.isMember && (
                    <AppText style={styles.memberLabel}>Already in group</AppText>
                )}
            </View>
            {option.isMember ? (
                <View style={styles.memberBadge}>
                    <AppText style={styles.memberBadgeText}>Member</AppText>
                </View>
            ) : (
                <View
                    style={[
                        styles.checkbox,
                        props.selected && styles.checkboxSelected,
                    ]}
                >
                    {props.selected && (
                        <Check
                            size={15}
                            color={theme.colors.accentText}
                            strokeWidth={3}
                        />
                    )}
                </View>
            )}
        </Pressable>
    );
}

function TopBar(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={(): void => router.back()}
            >
                <AppText style={styles.backText}>‹</AppText>
            </Pressable>
            <AppText style={styles.topBarTitle} numberOfLines={1}>
                Add members
            </AppText>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function StateBlock(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.centered}>
            <AppText variant="title">{props.title}</AppText>
            <AppText style={styles.stateDetail}>{props.detail}</AppText>
            {props.onRetry !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry"
                    style={styles.retryButton}
                    onPress={props.onRetry}
                >
                    <AppText style={styles.retryText}>Retry</AppText>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <AppText style={styles.backLinkText}>Go back</AppText>
            </Pressable>
        </View>
    );
}

// ── helpers ────────────────────────────────────────────────────────────────

function describeAddError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 400:
                return 'That request is not valid.';
            case 403:
                return "You don't have permission to add members.";
            case 429:
                return 'Too many additions, please wait a moment.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    return error instanceof Error
        ? error.message
        : 'Could not add those people.';
}

function describeInfoError(error: Error | null): string {
    if (error instanceof ApiError && error.statusCode === 403) {
        return 'You no longer have access to this group.';
    }
    if (error instanceof ApiError && error.statusCode === 400) {
        return 'This screen is only available for groups.';
    }
    return 'Could not load this group.';
}

function reportResult(result: AddMembersResult): void {
    if (result.added.length === 0 && result.failed.length === 0) return;
    const failures: readonly AddMemberFailure[] = result.failed;
    if (failures.length === 0) {
        toast.show(addMembersFeedback(result), { tone: 'success' });
        return;
    }
    if (result.added.length > 0) {
        toast.show(addMembersFeedback(result), { tone: 'warning' });
        return;
    }
    toast.show(addMembersFeedback(result), { tone: 'danger' });
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    contactsRoot: { flex: 1 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        paddingTop: 22,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.glassSurface,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { fontSize: 32, lineHeight: 34, color: theme.colors.text },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
    },
    topBarSpacer: { width: 44 },
    caption: { ...theme.type.caption, color: theme.colors.textMuted },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
    },
    input: {
        flex: 1,
        minHeight: 46,
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassSurface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.borderStrong,
        paddingHorizontal: spacing.sm,
        paddingRight: 44,
        fontSize: 16,
        color: theme.colors.text,
    },
    searchIcon: {
        position: 'absolute',
        right: 12,
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    stateCard: {
        alignItems: 'center',
        gap: spacing.xxs,
        marginTop: spacing.md,
        padding: spacing.lg,
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassSurface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
    },
    stateTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
        textAlign: 'center',
    },
    stateDetail: {
        ...theme.type.caption,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowName: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    rowNameMuted: { color: theme.colors.textSecondary },
    rowMeta: { ...theme.type.caption, color: theme.colors.textSecondary },
    memberLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: theme.accent,
    },
    contactsList: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.md,
        flexGrow: 1,
    },
    contactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 66,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
    },
    contactRowPressed: { backgroundColor: theme.colors.glassElevated },
    checkbox: {
        flexShrink: 0,
        width: 26,
        height: 26,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: theme.colors.borderStrong,
        backgroundColor: 'transparent',
    },
    checkboxSelected: {
        backgroundColor: theme.accent,
        borderColor: theme.accent,
    },
    memberBadge: {
        flexShrink: 0,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.xs,
        paddingVertical: 3,
        backgroundColor: theme.colors.accentSoft,
    },
    memberBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: theme.accent,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.borderStrong,
        backgroundColor: theme.colors.glassSurface,
    },
    selectionLabel: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    primaryButton: {
        minWidth: 108,
        minHeight: 44,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        backgroundColor: theme.accent,
    },
    primaryButtonDisabled: { backgroundColor: theme.colors.glassElevated },
    primaryButtonPressed: { backgroundColor: theme.accent },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: theme.colors.accentText,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
        backgroundColor: theme.colors.background,
    },
    retryButton: {
        marginTop: spacing.xs,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: theme.accent,
    },
    retryText: {
        color: theme.colors.accentText,
        fontSize: 14,
        fontWeight: '600',
    },
    backLink: { padding: spacing.sm },
    backLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.accent,
    },
});
