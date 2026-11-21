import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { EllipsisVertical } from 'lucide-react-native';
import { SafeText, UserAvatar } from '../../shared/components';
import {
    MAX_FONT_SCALE,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/theme';
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
            <View style={styles.avatarSlot}>
                <UserAvatar
                    userId={display.userId ?? Number(chat.id)}
                    name={display.title}
                    uri={display.avatarUri}
                    size={44}
                />
            </View>
            <View style={styles.body}>
                <View style={styles.titleRow}>
                    <SafeText
                        style={[typography.heading, styles.titleText]}
                        lines={1}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                        {display.title}
                    </SafeText>
                    {pinned && (
                        <Text
                            style={styles.pinGlyph}
                            numberOfLines={1}
                            maxFontSizeMultiplier={MAX_FONT_SCALE}
                            accessibilityLabel="Pinned chat"
                        >
                            📌
                        </Text>
                    )}
                </View>
                <SafeText
                    style={[
                        typography.caption,
                        styles.preview,
                        unread > 0 && styles.unreadPreview,
                    ]}
                    lines={1}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                    {previewText}
                </SafeText>
            </View>
            <View style={styles.meta}>
                {unread > 0 && (
                    <View
                        style={styles.unreadBadge}
                        accessibilityLabel={`${unread} unread messages`}
                    >
                        <Text
                            style={styles.unreadBadgeText}
                            numberOfLines={1}
                            maxFontSizeMultiplier={MAX_FONT_SCALE}
                        >
                            {unreadLabel}
                        </Text>
                    </View>
                )}
                <SafeText
                    style={[typography.caption, styles.time]}
                    lines={1}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                    {time.slice(11, 16)}
                </SafeText>
                {chat.isBan && (
                    <SafeText
                        style={styles.banBadge}
                        lines={1}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                        banned
                    </SafeText>
                )}
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
    // The one flex child of the row: it owns every pixel the fixed avatar,
    // trailing column and menu button leave over.
    avatarSlot: { width: 44, height: 44, flexShrink: 0 },
    body: { flex: 1, minWidth: 0, gap: 2 },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
        flexShrink: 1,
        minWidth: 0,
    },
    // `flex: 1` (not only flexShrink) is what makes the name use the WHOLE
    // remaining title width; the pin glyph keeps its intrinsic size.
    titleText: {
        flex: 1,
        minWidth: 0,
        includeFontPadding: false,
    },
    pinGlyph: { ...typography.micro, flexShrink: 0 },
    preview: {
        color: palette.text.secondary,
        minWidth: 0,
        includeFontPadding: false,
    },
    unreadPreview: { color: palette.text.primary, fontWeight: '700' },
    // Fixed trailing column: its width never shrinks because of a long name,
    // and a localised/oversized time string can never steal the text's width.
    meta: {
        alignItems: 'flex-end',
        flexShrink: 0,
        gap: 2,
        maxWidth: 72,
    },
    time: { flexShrink: 0 },
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
        ...typography.micro,
        color: palette.text.onAccent,
    },
    banBadge: { ...typography.micro, color: palette.semantic.danger },
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
