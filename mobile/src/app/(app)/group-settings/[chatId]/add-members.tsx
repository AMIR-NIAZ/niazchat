import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    AppText,
    SafeText,
    UserAvatar,
    palette,
    radii,
    shadows,
    spacing,
    typography,
} from '../../../../shared/components';
import { useReducedMotion } from '../../../../shared/hooks/use-reduced-motion';
import { measureInWindow } from '../../../../shared/context-popup/measure';
import type { ViewInstance } from '../../../../shared/context-popup/measure';
import type { PopupRect } from '../../../../shared/context-popup/popup-layout';
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
    publicUserIdLabel,
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

interface MissingIdHintState {
    id: number;
    anchor: PopupRect | null;
}

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function AddMembersScreen(): React.ReactElement {
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
    const infoQuery = useGroupInfo(chatId);
    const info = infoQuery.data;
    const allowed = info?.capabilities.canAddMembers === true;
    const addMutation = useAddGroupMembers(chatId);

    /** Users this screen already added (immediate duplicate prevention). */
    const [addedUserIds, setAddedUserIds] = useState<ReadonlySet<number>>(
        new Set(),
    );
    const [missingIdHint, setMissingIdHint] =
        useState<MissingIdHintState | null>(null);
    const hintSequence = useRef(0);

    const markAdded = useCallback((result: AddMembersResult): void => {
        if (result.added.length === 0) return;
        setAddedUserIds((current) => {
            const next = new Set(current);
            for (const member of result.added) next.add(member.userId);
            return next;
        });
    }, []);

    const showMissingIdHint = useCallback((anchor: PopupRect | null): void => {
        hintSequence.current += 1;
        setMissingIdHint({ id: hintSequence.current, anchor });
    }, []);

    const hideMissingIdHint = useCallback((id: number): void => {
        setMissingIdHint((current) =>
            current !== null && current.id === id ? null : current,
        );
    }, []);

    if (infoQuery.isPending && info === undefined) {
        return (
            <View style={styles.root}>
                <TopBar />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                    <Text style={styles.caption}>Loading group…</Text>
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
                onMissingId={showMissingIdHint}
                onSubmit={(userIds): Promise<AddMembersResult> =>
                    addMutation.mutateAsync(userIds)
                }
            />
            {missingIdHint !== null && (
                <MissingIdHint
                    key={missingIdHint.id}
                    hint={missingIdHint}
                    onHide={hideMissingIdHint}
                />
            )}
        </View>
    );
}

// ── Contacts ───────────────────────────────────────────────────────────────

function ContactsPicker(props: {
    chatId: number;
    addedUserIds: ReadonlySet<number>;
    busy: boolean;
    onAdded: (result: AddMembersResult) => void;
    onMissingId: (anchor: PopupRect | null) => void;
    onSubmit: (userIds: number[]) => Promise<AddMembersResult>;
}): React.ReactElement {
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
            onMissingId={props.onMissingId}
        />
    );

    return (
        <View style={styles.contactsRoot}>
            <View style={styles.searchRow}>
                <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search contacts"
                    placeholderTextColor={palette.neutral[500]}
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Search contacts"
                    style={styles.input}
                />
                <View style={styles.searchIcon}>
                    <Search
                        size={18}
                        color={palette.primary[300]}
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
                                color={palette.primary[500]}
                            />
                            <Text style={styles.stateDetail}>
                                Loading contacts…
                            </Text>
                        </View>
                    ) : loadError !== null ? (
                        <View style={styles.stateCard}>
                            <Text style={styles.stateTitle}>
                                Could not load contacts
                            </Text>
                            <Text style={styles.stateDetail}>{loadError}</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading contacts"
                                style={styles.retryButton}
                                onPress={(): void => {
                                    contactsQuery.refetch();
                                    void memberIdsQuery.refetch();
                                }}
                            >
                                <Text style={styles.retryText}>Retry</Text>
                            </Pressable>
                        </View>
                    ) : contactsQuery.contacts.length === 0 ? (
                        <View style={styles.stateCard}>
                            <Contact
                                size={26}
                                color={palette.primary[300]}
                                strokeWidth={1.8}
                            />
                            <Text style={styles.stateTitle}>
                                No saved contacts yet
                            </Text>
                            <Text style={styles.stateDetail}>
                                Add people in the Contacts tab first, then come
                                back here.
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.stateCard}>
                            <Text style={styles.stateTitle}>
                                No contacts found
                            </Text>
                            <Text style={styles.stateDetail}>
                                Try another name or username.
                            </Text>
                        </View>
                    )
                }
            />

            <View style={styles.footer}>
                <Text style={styles.selectionLabel}>
                    {selectedCountLabel(selectedCount) ??
                        'Select people to add'}
                </Text>
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
                            color={palette.text.onAccent}
                        />
                    ) : (
                        <Text style={styles.primaryButtonText}>
                            {selectedCount > 0 ? `Add ${selectedCount}` : 'Add'}
                        </Text>
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
    onMissingId: (anchor: PopupRect | null) => void;
}): React.ReactElement {
    const { option } = props;
    const isDisabled = option.isMember || props.disabled;
    const idRef = useRef<ViewInstance | null>(null);
    const publicId = publicUserIdLabel(option.userId);

    // The ID is its OWN pressable: opening the profile must never toggle the
    // row's selection. The child claims the touch, so the row's `onPress`
    // stays silent (no nested-Pressable double fire).
    const handleIdPress = (): void => {
        if (publicId !== null) {
            openUserProfile({
                userId: option.userId,
                name: option.displayName,
                avatar: option.avatarUrl,
            });
            return;
        }
        void measureInWindow(idRef).then((anchor): void => {
            props.onMissingId(anchor);
        });
    };

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
            <UserAvatar
                userId={option.userId}
                name={option.displayName}
                uri={option.avatarUrl}
                size={44}
            />
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
                    <Text style={styles.rowMeta} numberOfLines={1}>
                        @{option.username}
                    </Text>
                )}
                <Pressable
                    ref={idRef}
                    accessibilityRole="button"
                    accessibilityLabel={
                        publicId !== null
                            ? `Open profile of ${option.displayName}`
                            : `No public ID for ${option.displayName}`
                    }
                    accessibilityHint={
                        publicId !== null
                            ? 'Opens this user’s profile'
                            : 'Shows why this ID cannot open a profile'
                    }
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.idChip,
                        publicId === null && styles.idChipMissing,
                        pressed && styles.idChipPressed,
                    ]}
                    onPress={handleIdPress}
                >
                    <Text
                        style={[
                            styles.idText,
                            publicId === null && styles.idTextMissing,
                        ]}
                        numberOfLines={1}
                    >
                        {publicId !== null ? `ID ${publicId}` : 'No public ID'}
                    </Text>
                </Pressable>
                {option.isMember && (
                    <Text style={styles.memberLabel}>Already in group</Text>
                )}
            </View>
            {option.isMember ? (
                <View style={styles.memberBadge}>
                    <Text style={styles.memberBadgeText}>Member</Text>
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
                            color={palette.text.onAccent}
                            strokeWidth={3}
                        />
                    )}
                </View>
            )}
        </Pressable>
    );
}

// ── missing public ID hint ─────────────────────────────────────────────────

const HINT_WIDTH = 216;
const HINT_HEIGHT = 42;
const HINT_VISIBLE_MS = 1800;
const HINT_ENTER_MS = 160;
const HINT_EXIT_MS = 140;
const HINT_MARGIN = 12;

/**
 * Compact tooltip shown next to the tapped ID area when the contact has no
 * public User ID. It fades/scales in above everything (pointer-events off, so
 * it never blocks the list), then fades out and unmounts itself — no modal.
 */
function MissingIdHint(props: {
    hint: MissingIdHintState;
    onHide: (id: number) => void;
}): React.ReactElement {
    const insets = useSafeAreaInsets();
    const window = useWindowDimensions();
    const reducedMotion = useReducedMotion();
    const progress = useSharedValue(0);
    const hintId = props.hint.id;
    const anchor = props.hint.anchor;
    const onHide = props.onHide;

    useEffect((): (() => void) => {
        progress.value = reducedMotion
            ? 1
            : withTiming(1, {
                  duration: HINT_ENTER_MS,
                  easing: Easing.out(Easing.cubic),
              });

        const timeout = setTimeout((): void => {
            if (reducedMotion) {
                onHide(hintId);
                return;
            }
            progress.value = withTiming(
                0,
                {
                    duration: HINT_EXIT_MS,
                    easing: Easing.in(Easing.cubic),
                },
                (finished): void => {
                    if (finished) runOnJS(onHide)(hintId);
                },
            );
        }, HINT_VISIBLE_MS);

        return (): void => clearTimeout(timeout);
    }, [progress, reducedMotion, hintId, onHide]);

    const position = useMemo(() => {
        const minLeft = insets.left + HINT_MARGIN;
        const maxLeft = Math.max(
            minLeft,
            window.width - insets.right - HINT_MARGIN - HINT_WIDTH,
        );
        if (anchor === null) {
            return {
                left: Math.max(minLeft, (window.width - HINT_WIDTH) / 2),
                top: window.height - insets.bottom - HINT_HEIGHT - 96,
            };
        }
        const left = Math.min(
            Math.max(anchor.x + anchor.width / 2 - HINT_WIDTH / 2, minLeft),
            maxLeft,
        );
        const below = anchor.y + anchor.height + 8;
        const above = anchor.y - HINT_HEIGHT - 8;
        const fitsBelow =
            below + HINT_HEIGHT <= window.height - insets.bottom - HINT_MARGIN;
        return {
            left,
            top: Math.max(insets.top + HINT_MARGIN, fitsBelow ? below : above),
        };
    }, [anchor, insets, window]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ scale: interpolate(progress.value, [0, 1], [0.94, 1]) }],
    }));

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Animated.View
                accessibilityRole="alert"
                accessibilityLabel="This user doesn’t have a public ID."
                style={[
                    styles.hintBubble,
                    {
                        left: position.left,
                        top: position.top,
                        width: HINT_WIDTH,
                    },
                    animatedStyle,
                ]}
            >
                <Text style={styles.hintText}>
                    {"This user doesn't have a public ID."}
                </Text>
            </Animated.View>
        </View>
    );
}

function TopBar(): React.ReactElement {
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={(): void => router.back()}
            >
                <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
                Add members
            </Text>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function StateBlock(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    return (
        <View style={styles.centered}>
            <AppText variant="title">{props.title}</AppText>
            <Text style={styles.stateDetail}>{props.detail}</Text>
            {props.onRetry !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry"
                    style={styles.retryButton}
                    onPress={props.onRetry}
                >
                    <Text style={styles.retryText}>Retry</Text>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <Text style={styles.backLinkText}>Go back</Text>
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

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    contactsRoot: { flex: 1 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        paddingTop: 22,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border.subtle,
        backgroundColor: palette.surface,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { fontSize: 32, lineHeight: 34, color: palette.neutral[900] },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSpacer: { width: 44 },
    caption: { ...typography.caption, color: palette.text.muted },
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
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.strong,
        paddingHorizontal: spacing.sm,
        paddingRight: 44,
        fontSize: 16,
        color: palette.neutral[900],
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
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    stateTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
        textAlign: 'center',
    },
    stateDetail: {
        ...typography.caption,
        color: palette.text.secondary,
        textAlign: 'center',
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowName: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    rowNameMuted: { color: palette.neutral[500] },
    rowMeta: { ...typography.caption, color: palette.text.secondary },
    idChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 24,
        marginTop: 2,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radii.full,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.accent,
        backgroundColor: palette.glass.accent,
    },
    idChipPressed: { backgroundColor: palette.primary[100] },
    idChipMissing: {
        borderColor: palette.border.strong,
        backgroundColor: 'transparent',
    },
    idText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
        color: palette.primary[600],
    },
    idTextMissing: {
        fontWeight: '600',
        color: palette.text.muted,
    },
    hintBubble: {
        position: 'absolute',
        minHeight: HINT_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.md,
        backgroundColor: palette.elevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.accent,
        ...shadows.glass,
    },
    hintText: {
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17,
        textAlign: 'center',
        color: palette.neutral[900],
    },
    memberLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: palette.primary[600],
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
        borderBottomColor: palette.border.subtle,
    },
    contactRowPressed: { backgroundColor: palette.glass.elevated },
    checkbox: {
        flexShrink: 0,
        width: 26,
        height: 26,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: palette.border.strong,
        backgroundColor: 'transparent',
    },
    checkboxSelected: {
        backgroundColor: palette.primary[500],
        borderColor: palette.primary[300],
    },
    memberBadge: {
        flexShrink: 0,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.xs,
        paddingVertical: 3,
        backgroundColor: palette.primary[100],
    },
    memberBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: palette.primary[700],
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border.strong,
        backgroundColor: palette.surface,
    },
    selectionLabel: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: palette.text.secondary,
    },
    primaryButton: {
        minWidth: 108,
        minHeight: 44,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        backgroundColor: palette.primary[500],
    },
    primaryButtonDisabled: { backgroundColor: palette.neutral[100] },
    primaryButtonPressed: { backgroundColor: palette.primary[300] },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: palette.text.onAccent,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
        backgroundColor: palette.background,
    },
    retryButton: {
        marginTop: spacing.xs,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: palette.primary[500],
    },
    retryText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '600',
    },
    backLink: { padding: spacing.sm },
    backLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: palette.primary[600],
    },
});
