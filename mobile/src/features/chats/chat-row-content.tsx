import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { EllipsisVertical } from 'lucide-react-native';
import { UserAvatar } from '../../shared/components';
import { palette, radii, spacing, typography } from '../../shared/theme';
import { getChatDisplay } from './chats-model';
import type { ChatPreview } from './chats-model';

/**
 * The visual body of one chat row. Extracted so the long-press lifted preview
 * renders EXACTLY the same row (same width, avatar, title, preview, badge and
 * time) without mounting the live row's press handlers.
 */
export function ChatRowContent({
    chat,
    pinned,
    previewText,
    style,
    onMenuPress,
}: {
    chat: ChatPreview;
    pinned: boolean;
    previewText: string;
    style?: StyleProp<ViewStyle>;
    /** Opens the chat action menu. Omitted in the popup's lifted copy. */
    onMenuPress?: (() => void) | undefined;
}): React.ReactElement {
    const display = getChatDisplay(chat);
    const unread = chat.unreadCount;
    const unreadLabel = unread > 99 ? '99+' : String(unread);
    const time = chat.lastMessage?.createdAt ?? chat.updatedAt;
    const menuGlyph = (
        <EllipsisVertical
            size={18}
            strokeWidth={2}
            color={palette.text.secondary}
        />
    );

    return (
        <View style={[styles.row, style]}>
            <UserAvatar
                userId={display.userId ?? Number(chat.id)}
                name={display.title}
                uri={display.avatarUri}
                size={44}
            />
            <View style={styles.body}>
                <View style={styles.titleRow}>
                    <Text
                        style={[typography.heading, styles.titleText]}
                        numberOfLines={1}
                    >
                        {display.title}
                    </Text>
                    {pinned && (
                        <Text
                            style={styles.pinGlyph}
                            accessibilityLabel="Pinned chat"
                        >
                            📌
                        </Text>
                    )}
                </View>
                <Text
                    style={[
                        typography.caption,
                        styles.preview,
                        unread > 0 && styles.unreadPreview,
                    ]}
                    numberOfLines={1}
                >
                    {previewText}
                </Text>
            </View>
            <View style={styles.meta}>
                {unread > 0 && (
                    <View
                        style={styles.unreadBadge}
                        accessibilityLabel={`${unread} unread messages`}
                    >
                        <Text style={styles.unreadBadgeText}>
                            {unreadLabel}
                        </Text>
                    </View>
                )}
                <Text style={typography.caption}>{time.slice(11, 16)}</Text>
                {chat.isBan && <Text style={styles.banBadge}>banned</Text>}
            </View>
            {onMenuPress === undefined ? (
                // The lifted popup copy keeps the same trailing width and the
                // same glyph, so the row does not shift or lose a control when
                // the menu opens.
                <View style={styles.menuSlot}>{menuGlyph}</View>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Chat actions for ${display.title}`}
                    hitSlop={8}
                    onPress={onMenuPress}
                    style={({ pressed }) => [
                        styles.menuButton,
                        pressed && styles.menuButtonPressed,
                    ]}
                >
                    {menuGlyph}
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xxs,
        borderRadius: radii.sm,
    },
    body: { flex: 1, gap: 2 },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
    },
    titleText: { flexShrink: 1 },
    pinGlyph: { fontSize: 11 },
    preview: { color: palette.text.secondary },
    unreadPreview: { color: palette.text.primary, fontWeight: '700' },
    meta: { alignItems: 'flex-end', gap: 2 },
    unreadBadge: {
        minWidth: 18,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: radii.full / 2,
        backgroundColor: palette.primary[500],
        alignItems: 'center',
        justifyContent: 'center',
    },
    unreadBadgeText: {
        color: palette.text.onAccent,
        fontSize: 10,
        fontWeight: '700',
    },
    banBadge: { color: palette.semantic.danger, fontSize: 10 },
    // 32 px visual with an 8 px hitSlop: a comfortable iOS target inside the
    // row without widening the trailing column too much.
    menuSlot: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuButtonPressed: { backgroundColor: palette.glass.elevated },
});
