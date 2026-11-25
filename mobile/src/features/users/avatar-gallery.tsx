import { useEffect, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    ActivityIndicator,
    FlatList,
    Image,
    Modal,
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';

/** Minimal viewability token (RN no longer exports `ViewToken`). */
interface ViewToken {
    index?: number | undefined;
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    AppText,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/components';
import { dialog } from '../../shared/dialog';
import type { ProfileAvatar } from './use-profile';
import { useTheme, useThemedStyles, withAlpha } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';

/**
 * Multi-avatar UI for the profile screen:
 * - `AvatarGallery`: horizontal thumbnails, a current badge on the first one
 *   and an add tile at the end (replaced by the limit hint at 10).
 * - `AvatarViewer`: full-screen pager with promote/delete actions.
 * - `AvatarActionSheet`: the same actions, opened by long-pressing a thumbnail.
 *
 * `avatars[0]` is always the current photo (backend convention).
 */

interface AvatarGalleryProps {
    avatars: ProfileAvatar[];
    /**
     * Someone else's photos: thumbnails only (tap → viewer), no add/limit tile
     * and no long-press action sheet.
     */
    readOnly?: boolean;
    /** Own profile only: the photo limit that hides the add tile. */
    maxAvatars?: number;
    /** A new pick is being uploaded: shows a spinner tile at the end. */
    uploading?: boolean;
    /** Photo whose delete/promote is in flight: spinner overlay on its tile. */
    pendingFileName?: string | null;
    /** All actions disabled (mutation in flight / picking). */
    disabled?: boolean;
    /** Noun used in accessibility labels, e.g. "Group photo". */
    subject?: string;
    onPressAvatar: (index: number) => void;
    onLongPressAvatar?: (index: number) => void;
    onPressAdd?: () => void;
}

export function AvatarGallery({
    avatars,
    readOnly = false,
    maxAvatars = 0,
    uploading = false,
    pendingFileName = null,
    disabled = false,
    subject = 'Photo',
    onPressAvatar,
    onLongPressAvatar,
    onPressAdd,
}: AvatarGalleryProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const longPressed = useRef(false);
    const atLimit = avatars.length >= maxAvatars;

    return (
        <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.galleryRow}
            accessibilityLabel={readOnly ? `${subject}s` : `${subject} gallery`}
        >
            {avatars.map((avatar, index) => {
                const pending = pendingFileName === avatar.fileName;
                return (
                    <Pressable
                        key={avatar.fileName}
                        accessibilityRole="button"
                        accessibilityLabel={
                            index === 0
                                ? `${subject} ${index + 1}, current`
                                : `${subject} ${index + 1}`
                        }
                        accessibilityState={{ disabled: disabled || pending }}
                        disabled={disabled || pending}
                        onPress={(): void => {
                            // A long press already opened the action sheet.
                            if (longPressed.current) {
                                longPressed.current = false;
                                return;
                            }
                            onPressAvatar(index);
                        }}
                        onLongPress={
                            readOnly || onLongPressAvatar === undefined
                                ? undefined
                                : (): void => {
                                      longPressed.current = true;
                                      onLongPressAvatar(index);
                                  }
                        }
                        style={styles.tile}
                    >
                        {/* Thumbnail, not the original: the gallery tiles are
                            64 px squares. */}
                        <UserAvatar
                            userId={0}
                            name="Profile photo"
                            uri={avatar.url}
                            size={64}
                            borderRadius={radii.md}
                        />
                        {index === 0 && (
                            <View style={styles.currentBadge}>
                                <AppText style={styles.currentBadgeText}>
                                    Current
                                </AppText>
                            </View>
                        )}
                        {pending && (
                            <View style={styles.tileBusy}>
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.accentText}
                                />
                            </View>
                        )}
                    </Pressable>
                );
            })}

            {!readOnly && uploading && (
                <View
                    accessibilityLabel="Uploading photo"
                    accessible={true}
                    style={[styles.tile, styles.addTile]}
                >
                    <ActivityIndicator
                        size="small"
                        color={theme.accent}
                    />
                </View>
            )}

            {!readOnly &&
                !atLimit &&
                !uploading &&
                onPressAdd !== undefined && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${subject.toLowerCase()}`}
                        accessibilityState={{ disabled }}
                        disabled={disabled}
                        onPress={onPressAdd}
                        style={[
                            styles.tile,
                            styles.addTile,
                            disabled && styles.tileDisabled,
                        ]}
                    >
                        <AppText style={styles.addGlyph}>+</AppText>
                    </Pressable>
                )}

            {!readOnly && atLimit && (
                <View
                    accessible={true}
                    accessibilityLabel={`${maxAvatars} of ${maxAvatars} ${subject.toLowerCase()}s used`}
                    style={[styles.tile, styles.limitTile]}
                >
                    <AppText style={styles.limitText}>
                        {maxAvatars}/{maxAvatars}
                    </AppText>
                    <AppText style={styles.limitCaption}>Limit</AppText>
                </View>
            )}
        </ScrollView>
    );
}

interface AvatarViewerProps {
    visible: boolean;
    avatars: ProfileAvatar[];
    initialIndex: number;
    /**
     * Someone else's photos: swipe/close only — no "set as profile photo" and
     * no delete. The footer keeps the page counter.
     */
    readOnly?: boolean;
    busy?: boolean;
    pendingFileName?: string | null;
    /** Noun used in labels and announcements, e.g. "Group photo". */
    subject?: string;
    setMainLabel?: string;
    deleteLabel?: string;
    deleteConfirmTitle?: string;
    deleteConfirmMessage?: string;
    onClose: () => void;
    /** Resolves true only when the backend promoted the photo. */
    onSetMain?: (fileName: string) => Promise<boolean>;
    onDelete?: (fileName: string) => Promise<void>;
}

export function AvatarViewer({
    visible,
    avatars,
    initialIndex,
    readOnly = false,
    busy = false,
    pendingFileName = null,
    subject = 'Photo',
    setMainLabel = 'Set as profile photo',
    deleteLabel = 'Delete',
    deleteConfirmTitle = 'Delete this photo?',
    deleteConfirmMessage = 'It will be removed from your profile for everyone.',
    onClose,
    onSetMain,
    onDelete,
}: AvatarViewerProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const listRef = useRef<FlatList<ProfileAvatar>>(null);
    const [index, setIndex] = useState(initialIndex);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 60,
    }).current;
    const onViewableItemsChanged = useRef(
        (info: { viewableItems: ViewToken[] }): void => {
            const first = info.viewableItems[0];
            if (typeof first?.index === 'number') {
                setIndex(first.index);
            }
        },
    ).current;

    // Open on the tapped photo.
    useEffect((): (() => void) | void => {
        if (!visible) {
            return;
        }
        setIndex(initialIndex);
        const timer = setTimeout((): void => {
            listRef.current?.scrollToOffset({
                offset: initialIndex * width,
                animated: false,
            });
        }, 0);
        return (): void => clearTimeout(timer);
    }, [visible, initialIndex, width]);

    // After a delete the list shrinks: advance to the next photo, or close when
    // the last one was removed.
    useEffect((): void => {
        if (!visible) {
            return;
        }
        if (avatars.length === 0) {
            onCloseRef.current();
            return;
        }
        if (index > avatars.length - 1) {
            setIndex(avatars.length - 1);
        }
    }, [visible, avatars.length, index]);

    // Screen readers hear the page position.
    useEffect((): void => {
        if (!visible || avatars.length === 0) {
            return;
        }
        AccessibilityInfo.announceForAccessibility(
            `${subject} ${index + 1} of ${avatars.length}`,
        );
    }, [visible, index, avatars.length, subject]);

    // Swipe down to dismiss (horizontal swipes still page the list).
    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_event, gesture): boolean =>
                gesture.dy > 60 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
            onPanResponderRelease: (_event, gesture): void => {
                if (gesture.dy > 90) {
                    onCloseRef.current();
                }
            },
        }),
    ).current;

    const current = avatars[index];
    const isCurrent = index === 0;
    const pending =
        current !== undefined && pendingFileName === current.fileName;

    const confirmDelete = (): void => {
        if (current === undefined || busy || onDelete === undefined) {
            return;
        }
        const fileName = current.fileName;
        void dialog
            .confirm({
                title: deleteConfirmTitle,
                message: deleteConfirmMessage,
                confirmText: 'Delete',
                destructive: true,
            })
            .then((confirmed): void => {
                if (confirmed && onDelete !== undefined) {
                    void onDelete(fileName);
                }
            });
    };

    const renderItem = ({
        item,
    }: ListRenderItemInfo<ProfileAvatar>): React.ReactElement => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            onPress={onClose}
            style={[styles.viewerPage, { width, height }]}
        >
            <Image
                accessibilityLabel={`Full size ${subject.toLowerCase()}`}
                resizeMode="contain"
                style={styles.viewerImage}
                source={{ uri: item.url }}
            />
        </Pressable>
    );

    return (
        <Modal
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
            transparent={false}
        >
            <View style={styles.viewerRoot} {...panResponder.panHandlers}>
                <FlatList
                    ref={listRef}
                    horizontal={true}
                    pagingEnabled={true}
                    showsHorizontalScrollIndicator={false}
                    data={avatars}
                    keyExtractor={(item): string => item.fileName}
                    renderItem={renderItem}
                    viewabilityConfig={viewabilityConfig}
                    onViewableItemsChanged={onViewableItemsChanged}
                    getItemLayout={(
                        _data,
                        itemIndex,
                    ): {
                        length: number;
                        offset: number;
                        index: number;
                    } => ({
                        length: width,
                        offset: width * itemIndex,
                        index: itemIndex,
                    })}
                />

                <View
                    style={[
                        styles.viewerTop,
                        { paddingTop: insets.top + spacing.sm },
                    ]}
                    pointerEvents="box-none"
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close photo viewer"
                        onPress={onClose}
                        style={styles.viewerClose}
                    >
                        <AppText style={styles.viewerCloseText}>✕</AppText>
                    </Pressable>
                </View>

                <View
                    style={[
                        styles.viewerFooter,
                        { paddingBottom: insets.bottom + spacing.md },
                    ]}
                >
                    <AppText
                        style={styles.viewerCounter}
                        accessibilityLiveRegion="polite"
                        accessibilityLabel={`${subject} ${index + 1} of ${avatars.length}`}
                    >
                        {index + 1} of {avatars.length}
                    </AppText>

                    {!readOnly &&
                        (busy || pending ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.accentText}
                            />
                        ) : (
                            <View style={styles.viewerActions}>
                                {!isCurrent && onSetMain !== undefined && (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={setMainLabel}
                                        onPress={(): void => {
                                            if (
                                                current === undefined ||
                                                onSetMain === undefined
                                            ) {
                                                return;
                                            }
                                            void onSetMain(
                                                current.fileName,
                                            ).then((promoted): void => {
                                                if (!promoted) {
                                                    return;
                                                }
                                                setIndex(0);
                                                listRef.current?.scrollToOffset(
                                                    {
                                                        offset: 0,
                                                        animated: true,
                                                    },
                                                );
                                            });
                                        }}
                                        style={[
                                            styles.viewerButton,
                                            styles.viewerButtonPrimary,
                                        ]}
                                    >
                                        <AppText style={styles.viewerButtonText}>
                                            {setMainLabel}
                                        </AppText>
                                    </Pressable>
                                )}
                                {onDelete !== undefined && (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={deleteLabel}
                                        onPress={confirmDelete}
                                        style={[
                                            styles.viewerButton,
                                            styles.viewerButtonDanger,
                                        ]}
                                    >
                                        <AppText
                                            style={[
                                                styles.viewerButtonText,
                                                styles.viewerDangerText,
                                            ]}
                                        >
                                            {deleteLabel}
                                        </AppText>
                                    </Pressable>
                                )}
                            </View>
                        ))}
                </View>
            </View>
        </Modal>
    );
}

interface AvatarActionSheetProps {
    avatar: ProfileAvatar | null;
    isCurrent: boolean;
    busy: boolean;
    onSetMain: () => void;
    onDelete: () => void;
    onDismiss: () => void;
}

export function AvatarActionSheet({
    avatar,
    isCurrent,
    busy,
    onSetMain,
    onDelete,
    onDismiss,
}: AvatarActionSheetProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    if (avatar === null) {
        return <View />;
    }
    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="slide"
            onRequestClose={onDismiss}
        >
            <Pressable style={styles.sheetBackdrop} onPress={onDismiss}>
                <Pressable style={styles.sheetCard}>
                    <AppText variant="caption" style={styles.sheetTitle}>
                        Profile photo
                    </AppText>
                    {busy ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.accent}
                        />
                    ) : (
                        <>
                            {!isCurrent && (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Set as profile photo"
                                    style={styles.sheetButton}
                                    onPress={onSetMain}
                                >
                                    <AppText style={styles.sheetActionText}>
                                        Set as profile photo
                                    </AppText>
                                </Pressable>
                            )}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Delete photo"
                                style={styles.sheetButton}
                                onPress={onDelete}
                            >
                                <AppText style={styles.sheetDeleteText}>
                                    Delete photo
                                </AppText>
                            </Pressable>
                            <View style={styles.sheetDivider} />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Cancel"
                                style={styles.sheetButton}
                                onPress={onDismiss}
                            >
                                <AppText style={styles.sheetCancelText}>
                                    Cancel
                                </AppText>
                            </Pressable>
                        </>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    galleryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xxs,
        paddingHorizontal: spacing.xxs,
    },
    tile: {
        width: 64,
        height: 64,
        borderRadius: radii.md,
        overflow: 'hidden',
        backgroundColor: theme.colors.glassElevated,
    },
    tileDisabled: { opacity: 0.5 },
    thumb: { width: '100%', height: '100%' },
    currentBadge: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: withAlpha(theme.colors.background, 0.72),
        paddingVertical: 2,
        alignItems: 'center',
    },
    currentBadgeText: {
        color: theme.colors.accentText,
        fontSize: 9,
        fontWeight: '700',
    },
    tileBusy: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(theme.colors.background, 0.45),
    },
    addTile: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.accent,
        borderStyle: 'dashed',
        backgroundColor: theme.colors.accentSoft,
    },
    addGlyph: {
        color: theme.accent,
        fontSize: 28,
        fontWeight: '600',
        lineHeight: 30,
    },
    limitTile: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.glassElevated,
        gap: 2,
    },
    limitText: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '700',
    },
    limitCaption: { ...theme.type.caption, fontSize: 9 },
    viewerRoot: { flex: 1, backgroundColor: theme.colors.text },
    viewerPage: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    viewerImage: { width: '100%', height: '80%' },
    viewerTop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        alignItems: 'flex-end',
        paddingHorizontal: spacing.md,
    },
    viewerClose: {
        width: 40,
        height: 40,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.quoteOwn,
    },
    viewerCloseText: {
        color: theme.colors.accentText,
        fontSize: 18,
        fontWeight: '600',
    },
    viewerFooter: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: spacing.md,
        gap: spacing.sm,
        alignItems: 'center',
    },
    viewerCounter: {
        color: theme.colors.surfaceElevated,
        fontSize: 13,
        fontWeight: '600',
    },
    viewerActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: spacing.xs,
    },
    viewerButton: {
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    viewerButtonPrimary: { backgroundColor: theme.accent },
    viewerButtonDanger: {
        borderWidth: 1,
        borderColor: theme.colors.danger,
    },
    viewerButtonText: {
        color: theme.colors.accentText,
        fontSize: 14,
        fontWeight: '600',
    },
    viewerDangerText: { color: theme.colors.danger },
    sheetBackdrop: {
        flex: 1,
        backgroundColor: withAlpha(theme.colors.background, 0.45),
        justifyContent: 'flex-end',
    },
    sheetCard: {
        backgroundColor: theme.colors.background,
        borderTopLeftRadius: radii.lg,
        borderTopRightRadius: radii.lg,
        padding: spacing.md,
        gap: spacing.xxs,
    },
    sheetTitle: { paddingVertical: spacing.xs },
    sheetButton: {
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
    },
    sheetActionText: {
        color: theme.colors.text,
        fontSize: 16,
        fontWeight: '500',
    },
    sheetDeleteText: {
        color: theme.colors.danger,
        fontSize: 16,
        fontWeight: '500',
    },
    sheetCancelText: {
        color: theme.colors.text,
        fontSize: 16,
        fontWeight: '500',
    },
    sheetDivider: {
        height: 1,
        backgroundColor: theme.colors.glassElevated,
        marginVertical: spacing.xxs,
    },
});
