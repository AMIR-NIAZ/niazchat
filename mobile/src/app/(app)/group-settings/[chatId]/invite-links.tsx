import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    RefreshControl,
    Share,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, palette, radii, spacing,
    AppText,
} from '../../../../shared/components';
import { dialog, toast } from '../../../../shared/dialog';
import { purgeChatFromCaches } from '../../../../features/chats';
import { describeInviteLinkError } from '../../../../features/groups/group-errors';
import { openMessageLink } from '../../../../features/groups/open-invite-link';
import {
    DEFAULT_INVITE_CREATE_INPUT,
    INVITE_EXPIRY_CHOICES,
    INVITE_MAX_USES_CHOICES,
    inviteCreatedByLabel,
    inviteExpiryLabel,
    inviteLinkUrl,
    inviteShareMessage,
    inviteStatusLabel,
    inviteUsesLabel,
    splitInviteLinks,
    type InviteChoice,
    type InviteLinkDto,
} from '../../../../features/groups/invite-links-model';
import {
    useCreateInviteLink,
    useInviteLinks,
    useRevokeInviteLink,
} from '../../../../features/groups/use-invite-links';
import {
    useGroupChangedEvents,
    useGroupInfo,
    useGroupRemovedEvent,
    useGroupUpdatedEvents,
} from '../../../../features/groups/use-group';
import { useTheme, useThemedStyles, withAlpha } from '../../../../shared/theme';
import type { AppTheme } from '../../../../shared/theme';

/**
 * Invite links screen (`/group-settings/:chatId/invite-links`).
 *
 * Only reaches a usable state when the server granted
 * `capabilities.canManageInviteLinks`; losing it while the screen is open
 * refetches and leaves with a notice. Realtime `group:changed` reasons
 * `invite_links_changed` and `member_joined` invalidate the list through
 * `useGroupChangedEvents`.
 */

const NOTICE_MS = 2500;
const COPIED_MS = 1800;

type RouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function InviteLinksScreen(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const params = useLocalSearchParams<RouteParams>();
    const chatId = parseChatId(params.chatId);
    if (chatId === null) {
        return (
            <Screen style={styles.centered} withTopInset={true}>
                <AppText style={styles.stateTitle}>Invite links unavailable</AppText>
                <AppText style={styles.stateDetail}>
                    This group link is not valid.
                </AppText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to chats"
                    style={styles.primaryButton}
                    onPress={(): void => router.replace('/(app)')}
                >
                    <AppText style={styles.primaryButtonText}>Back to chats</AppText>
                </Pressable>
            </Screen>
        );
    }
    return <InviteLinksPanel chatId={chatId} />;
}

function InviteLinksPanel({ chatId }: { chatId: number }): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const queryClient = useQueryClient();
    const infoQuery = useGroupInfo(chatId);
    const linksQuery = useInviteLinks(chatId);
    const createLink = useCreateInviteLink(chatId);
    const revokeLink = useRevokeInviteLink(chatId);

    const [now, setNow] = useState<number>(Date.now());
    const [sheetOpen, setSheetOpen] = useState(false);
    const [expiry, setExpiry] = useState<number | null>(
        DEFAULT_INVITE_CREATE_INPUT.expiresInSeconds,
    );
    const [maxUses, setMaxUses] = useState<number | null>(
        DEFAULT_INVITE_CREATE_INPUT.maxUses,
    );
    const [highlightId, setHighlightId] = useState<number | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [accessLost, setAccessLost] = useState(false);
    const listRef = useRef<FlatList<InviteLinkDto>>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useGroupChangedEvents(chatId);
    useGroupUpdatedEvents();

    // Relative labels ("Expires in 3 minutes") stay fresh while focused.
    useFocusEffect(
        useCallback((): (() => void) => {
            void linksQuery.refetch();
            setNow(Date.now());
            const timer = setInterval((): void => setNow(Date.now()), 30_000);
            return (): void => clearInterval(timer);
        }, [linksQuery.refetch]),
    );

    useEffect((): (() => void) => {
        return (): void => {
            if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
            if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
            if (highlightTimer.current !== null) {
                clearTimeout(highlightTimer.current);
            }
        };
    }, []);

    const handleRemoved = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        toast.show('You were removed from this group');
        router.replace('/(app)');
    }, [queryClient, chatId]);
    useGroupRemovedEvent(chatId, handleRemoved);

    const info = infoQuery.data;
    const canManage = info?.capabilities.canManageInviteLinks === true;

    // The server revoked the capability for this caller (demote/permission
    // change): the screen is no longer allowed to exist.
    useEffect((): void => {
        if (info === undefined || canManage || accessLost) return;
        setAccessLost(true);
        dialog.show({
            title: 'Access changed',
            message: 'You can no longer manage invite links for this group.',
            tone: 'warning',
        });
        router.replace('/(app)');
    }, [canManage, accessLost]);

    const page = linksQuery.data;
    const activeCount = page?.activeCount ?? 0;
    const maxActive = page?.maxActive ?? 10;
    const atLimit = activeCount >= maxActive;
    const { active, inactive } = splitInviteLinks(page?.items ?? []);
    const rows: InviteLinkDto[] = [...active, ...inactive];

    const showNotice = (text: string): void => {
        setNotice(text);
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(
            (): void => setNotice(null),
            NOTICE_MS,
        );
    };

    const copyLink = async (link: InviteLinkDto): Promise<void> => {
        try {
            await Clipboard.setStringAsync(inviteLinkUrl(link.code));
            setCopiedId(link.id);
            showNotice('Link copied');
            if (copiedTimer.current !== null) {
                clearTimeout(copiedTimer.current);
            }
            copiedTimer.current = setTimeout(
                (): void => setCopiedId(null),
                COPIED_MS,
            );
        } catch {
            dialog.show({
                title: 'Could not copy',
                message: 'Try sharing the link instead.',
                tone: 'danger',
            });
        }
    };

    const shareLink = async (link: InviteLinkDto): Promise<void> => {
        try {
            await Share.share({
                message: inviteShareMessage(info?.title ?? '', link.code),
            });
        } catch {
            // The share sheet was dismissed; nothing changed.
        }
    };

    const confirmRevoke = (link: InviteLinkDto): void => {
        void dialog
            .confirm({
                title: 'Revoke this link?',
                message: 'People who already joined stay in the group.',
                confirmText: 'Revoke',
                destructive: true,
            })
            .then((confirmed): void => {
                if (!confirmed) {
                    return;
                }
                revokeLink.mutate(link.id, {
                    onSuccess: (): void => {
                        showNotice('Link revoked');
                    },
                    onError: (error): void => {
                        dialog.show({
                            title: 'Could not revoke link',
                            message: describeInviteLinkError(error),
                            tone: 'danger',
                        });
                    },
                });
            });
    };

    const openSheet = (): void => {
        setExpiry(DEFAULT_INVITE_CREATE_INPUT.expiresInSeconds);
        setMaxUses(DEFAULT_INVITE_CREATE_INPUT.maxUses);
        setSheetOpen(true);
    };

    const submitCreate = async (): Promise<void> => {
        if (createLink.isPending) return;
        try {
            const created = await createLink.mutateAsync({
                expiresInSeconds: expiry,
                maxUses,
            });
            setSheetOpen(false);
            setHighlightId(created.id);
            showNotice('Invite link created');
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
            if (highlightTimer.current !== null) {
                clearTimeout(highlightTimer.current);
            }
            highlightTimer.current = setTimeout(
                (): void => setHighlightId(null),
                4000,
            );
        } catch (error) {
            dialog.show({
                title: 'Could not create link',
                message: describeInviteLinkError(error),
                tone: 'danger',
            });
        }
    };

    const listHeader = (
        <View>
            <AppText style={styles.intro}>
                Anyone with an active link can join this group. Links can expire
                or stop working after a number of uses.
            </AppText>
            <View style={styles.createRow}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create invite link"
                    accessibilityState={{
                        disabled: atLimit || createLink.isPending,
                    }}
                    disabled={atLimit || createLink.isPending}
                    onPress={openSheet}
                    style={({ pressed }) => [
                        styles.primaryButton,
                        (atLimit || createLink.isPending) &&
                            styles.primaryButtonDisabled,
                        pressed && styles.primaryButtonPressed,
                    ]}
                >
                    <AppText style={styles.primaryButtonText}>Create link</AppText>
                </Pressable>
                <AppText style={styles.countText}>
                    {activeCount} / {maxActive} active
                </AppText>
            </View>
            {atLimit && (
                <AppText style={styles.limitNote}>
                    Too many active links. Revoke one first.
                </AppText>
            )}
            {notice !== null && (
                <AppText style={styles.notice} accessibilityLiveRegion="polite">
                    {notice}
                </AppText>
            )}
            {linksQuery.isError && page !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading invite links"
                    onPress={(): void => {
                        void linksQuery.refetch();
                    }}
                >
                    <AppText style={styles.inlineError}>
                        Could not refresh. Tap to retry.
                    </AppText>
                </Pressable>
            )}
        </View>
    );

    const topBar = (
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
                Invite links
            </AppText>
            <View style={styles.topBarSpacer} />
        </View>
    );

    return (
        <Screen style={styles.screen} withTopInset={true}>
            {topBar}
            <FlatList
                ref={listRef}
                data={rows}
                keyExtractor={(item): string => String(item.id)}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={
                    linksQuery.isPending ? (
                        <LoadingSkeleton />
                    ) : linksQuery.isError ? (
                        <View style={styles.listState}>
                            <AppText style={styles.stateTitle}>
                                Could not load invite links
                            </AppText>
                            <AppText style={styles.stateDetail}>
                                {describeInviteLinkError(linksQuery.error)}
                            </AppText>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading invite links"
                                style={styles.primaryButton}
                                onPress={(): void => {
                                    void linksQuery.refetch();
                                }}
                            >
                                <AppText style={styles.primaryButtonText}>
                                    Retry
                                </AppText>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.listState}>
                            <AppText style={styles.stateTitle}>
                                No invite links yet
                            </AppText>
                            <AppText style={styles.stateDetail}>
                                Create one to let people join.
                            </AppText>
                        </View>
                    )
                }
                renderItem={({ item, index }): React.ReactElement => {
                    const firstInactive =
                        item.status !== 'active' &&
                        (index === 0 || rows[index - 1]?.status === 'active');
                    return (
                        <View>
                            {firstInactive && (
                                <AppText style={styles.sectionTitle}>
                                    Inactive
                                </AppText>
                            )}
                            <InviteLinkCard
                                link={item}
                                now={now}
                                copied={copiedId === item.id}
                                highlighted={highlightId === item.id}
                                revoking={
                                    revokeLink.isPending &&
                                    revokeLink.variables === item.id
                                }
                                onCopy={(): void => {
                                    void copyLink(item);
                                }}
                                onOpen={(): void =>
                                    openMessageLink(inviteLinkUrl(item.code))
                                }
                                onShare={(): void => {
                                    void shareLink(item);
                                }}
                                onRevoke={(): void => confirmRevoke(item)}
                            />
                        </View>
                    );
                }}
                refreshControl={
                    <RefreshControl
                        refreshing={
                            linksQuery.isRefetching && !linksQuery.isPending
                        }
                        onRefresh={(): void => {
                            void linksQuery.refetch();
                            void infoQuery.refetch();
                        }}
                        tintColor={theme.accent}
                    />
                }
            />

            <CreateInviteLinkSheet
                visible={sheetOpen}
                expiry={expiry}
                maxUses={maxUses}
                busy={createLink.isPending}
                onChangeExpiry={setExpiry}
                onChangeMaxUses={setMaxUses}
                onClose={(): void => {
                    if (!createLink.isPending) setSheetOpen(false);
                }}
                onSubmit={(): void => {
                    void submitCreate();
                }}
            />
        </Screen>
    );
}

function InviteLinkCard(props: {
    link: InviteLinkDto;
    now: number;
    copied: boolean;
    highlighted: boolean;
    revoking: boolean;
    onCopy: () => void;
    onOpen: () => void;
    onShare: () => void;
    onRevoke: () => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const { link } = props;
    const active = link.status === 'active';
    return (
        <View
            style={[styles.card, props.highlighted && styles.cardHighlighted]}
        >
            <View style={styles.cardTop}>
                <View
                    style={[
                        styles.statusBadge,
                        active && styles.statusBadgeActive,
                    ]}
                >
                    <AppText
                        style={[
                            styles.statusText,
                            active && styles.statusTextActive,
                        ]}
                    >
                        {inviteStatusLabel(link.status)}
                    </AppText>
                </View>
                <AppText style={styles.usesText}>{inviteUsesLabel(link)}</AppText>
            </View>

            <AppText
                style={styles.url}
                numberOfLines={1}
                ellipsizeMode="middle"
                accessibilityRole="link"
                accessibilityLabel={`Open invite link ${inviteLinkUrl(link.code)}`}
                onPress={props.onOpen}
            >
                {inviteLinkUrl(link.code)}
            </AppText>
            <AppText style={styles.meta} numberOfLines={1}>
                {inviteCreatedByLabel(link, props.now)}
            </AppText>
            <AppText style={styles.meta} numberOfLines={1}>
                {inviteExpiryLabel(link.expiresAt, props.now)}
            </AppText>

            {active && (
                <View style={styles.actions}>
                    <CardAction
                        label={props.copied ? 'Copied' : 'Copy'}
                        accessibilityLabel="Copy link"
                        onPress={props.onCopy}
                    />
                    <CardAction
                        label="Share"
                        accessibilityLabel="Share link"
                        onPress={props.onShare}
                    />
                    <CardAction
                        label={props.revoking ? 'Revoking…' : 'Revoke'}
                        accessibilityLabel="Revoke link"
                        destructive={true}
                        disabled={props.revoking}
                        onPress={props.onRevoke}
                    />
                </View>
            )}
            {props.copied && <AppText style={styles.copiedText}>Link copied</AppText>}
        </View>
    );
}

function CardAction(props: {
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
    destructive?: boolean;
    disabled?: boolean;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            accessibilityState={{ disabled: props.disabled === true }}
            disabled={props.disabled === true}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.cardAction,
                pressed && styles.cardActionPressed,
            ]}
        >
            <AppText
                style={[
                    styles.cardActionText,
                    props.destructive === true && styles.cardActionDestructive,
                ]}
            >
                {props.label}
            </AppText>
        </Pressable>
    );
}

function CreateInviteLinkSheet(props: {
    visible: boolean;
    expiry: number | null;
    maxUses: number | null;
    busy: boolean;
    onChangeExpiry: (value: number | null) => void;
    onChangeMaxUses: (value: number | null) => void;
    onClose: () => void;
    onSubmit: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <Modal
            visible={props.visible}
            transparent={true}
            animationType="slide"
            onRequestClose={props.onClose}
        >
            <View style={styles.sheetBackdrop}>
                <View style={styles.sheet}>
                    <AppText style={styles.sheetTitle}>Create invite link</AppText>
                    <AppText style={styles.sheetHint}>
                        The link works until it is revoked, expires or reaches
                        its usage limit.
                    </AppText>

                    <AppText style={styles.sheetLabel}>Expiry</AppText>
                    <ChoiceRow
                        choices={INVITE_EXPIRY_CHOICES}
                        value={props.expiry}
                        disabled={props.busy}
                        onChange={props.onChangeExpiry}
                    />

                    <AppText style={styles.sheetLabel}>Usage limit</AppText>
                    <ChoiceRow
                        choices={INVITE_MAX_USES_CHOICES}
                        value={props.maxUses}
                        disabled={props.busy}
                        onChange={props.onChangeMaxUses}
                    />

                    <View style={styles.sheetActions}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel creating invite link"
                            disabled={props.busy}
                            onPress={props.onClose}
                            style={styles.secondaryButton}
                        >
                            <AppText style={styles.secondaryButtonText}>
                                Cancel
                            </AppText>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Create invite link"
                            accessibilityState={{ disabled: props.busy }}
                            disabled={props.busy}
                            onPress={props.onSubmit}
                            style={({ pressed }) => [
                                styles.primaryButton,
                                styles.sheetCreate,
                                pressed && styles.primaryButtonPressed,
                                props.busy && styles.primaryButtonDisabled,
                            ]}
                        >
                            {props.busy ? (
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.accentText}
                                />
                            ) : (
                                <AppText style={styles.primaryButtonText}>
                                    Create
                                </AppText>
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

function ChoiceRow(props: {
    choices: readonly InviteChoice<number | null>[];
    value: number | null;
    disabled: boolean;
    onChange: (value: number | null) => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.chipRow}>
            {props.choices.map((choice) => {
                const selected = choice.value === props.value;
                return (
                    <Pressable
                        key={String(choice.value)}
                        accessibilityRole="button"
                        accessibilityLabel={`${choice.label}${selected ? ', selected' : ''}`}
                        accessibilityState={{
                            selected,
                            disabled: props.disabled,
                        }}
                        disabled={props.disabled}
                        onPress={(): void => props.onChange(choice.value)}
                        style={[styles.chip, selected && styles.chipSelected]}
                    >
                        <AppText
                            style={[
                                styles.chipText,
                                selected && styles.chipTextSelected,
                            ]}
                        >
                            {choice.label}
                        </AppText>
                    </Pressable>
                );
            })}
        </View>
    );
}

function LoadingSkeleton(): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.skeletonWrap}>
            {[0, 1, 2].map((index) => (
                <View key={index} style={styles.skeletonCard}>
                    <View style={styles.skeletonLineShort} />
                    <View style={styles.skeletonLineWide} />
                    <View style={styles.skeletonLine} />
                </View>
            ))}
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.glassElevated,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: {
        fontSize: 32,
        lineHeight: 34,
        color: theme.colors.text,
    },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
    },
    topBarSpacer: { width: 44 },
    listContent: {
        paddingBottom: spacing.xl,
    },
    intro: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
    },
    createRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
    },
    countText: {
        color: theme.colors.textSecondary,
        fontSize: 13,
    },
    limitNote: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.xs,
        color: theme.colors.danger,
        fontSize: 13,
    },
    notice: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xxs,
        color: theme.colors.success,
        fontSize: 13,
    },
    inlineError: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xxs,
        color: theme.colors.danger,
        fontSize: 13,
    },
    sectionTitle: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    card: {
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        padding: spacing.md,
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        gap: spacing.xxs,
    },
    cardHighlighted: {
        borderColor: theme.accent,
        borderWidth: 2,
    },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    statusBadge: {
        borderRadius: radii.sm,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        backgroundColor: theme.colors.glassElevated,
    },
    statusBadgeActive: {
        backgroundColor: theme.colors.success,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '700',
        color: theme.colors.textSecondary,
    },
    statusTextActive: {
        color: theme.colors.accentText,
    },
    usesText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    url: {
        marginTop: spacing.xxs,
        color: theme.accent,
        fontSize: 14,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    meta: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginTop: spacing.xs,
    },
    cardAction: {
        borderRadius: radii.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.accent,
        paddingHorizontal: spacing.sm,
        paddingVertical: 5,
    },
    cardActionPressed: { backgroundColor: theme.colors.accentSoft },
    cardActionText: {
        color: theme.accent,
        fontSize: 13,
        fontWeight: '600',
    },
    cardActionDestructive: {
        color: theme.colors.danger,
    },
    copiedText: {
        marginTop: spacing.xxs,
        color: theme.colors.success,
        fontSize: 12,
    },
    listState: {
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
    },
    stateTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    stateDetail: {
        color: theme.colors.textSecondary,
        textAlign: 'center',
        fontSize: 13,
    },
    primaryButton: {
        alignSelf: 'flex-start',
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: theme.accent,
        minWidth: 96,
        alignItems: 'center',
    },
    primaryButtonPressed: { opacity: 0.85 },
    primaryButtonDisabled: { opacity: 0.45 },
    primaryButtonText: {
        color: theme.colors.accentText,
        fontSize: 14,
        fontWeight: '600',
    },
    secondaryButton: {
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
    },
    secondaryButtonText: {
        color: theme.accent,
        fontSize: 14,
        fontWeight: '600',
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
        backgroundColor: theme.colors.background,
    },
    sheetBackdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: withAlpha(theme.colors.background, 0.62),
    },
    sheet: {
        backgroundColor: theme.colors.glassElevated,
        borderTopLeftRadius: radii.md,
        borderTopRightRadius: radii.md,
        padding: spacing.md,
        paddingBottom: spacing.lg,
        gap: spacing.xs,
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: theme.colors.text,
    },
    sheetHint: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
    sheetLabel: {
        marginTop: spacing.xs,
        fontSize: 13,
        fontWeight: '700',
        color: theme.colors.text,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    chip: {
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        backgroundColor: theme.colors.glassElevated,
    },
    chipSelected: {
        backgroundColor: theme.accent,
    },
    chipText: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: '600',
    },
    chipTextSelected: {
        color: theme.colors.accentText,
    },
    sheetActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
    sheetCreate: {
        alignSelf: 'auto',
    },
    skeletonWrap: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        gap: spacing.sm,
    },
    skeletonCard: {
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassElevated,
        padding: spacing.md,
        gap: spacing.xs,
    },
    skeletonLine: {
        height: 10,
        width: '55%',
        borderRadius: 5,
        backgroundColor: theme.colors.glassElevated,
    },
    skeletonLineWide: {
        height: 12,
        width: '85%',
        borderRadius: 6,
        backgroundColor: theme.colors.glassElevated,
    },
    skeletonLineShort: {
        height: 10,
        width: '25%',
        borderRadius: 5,
        backgroundColor: theme.colors.glassElevated,
    },
});
