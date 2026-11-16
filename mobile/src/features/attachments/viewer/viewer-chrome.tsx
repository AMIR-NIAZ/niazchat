import { memo } from 'react';
import type { RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { MoreHorizontal, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { UserAvatar } from '../../../shared/components';
import type { ViewInstance } from '../../../shared/context-popup';
import { palette, radii, spacing } from '../../../shared/theme';
import { useReducedMotion } from '../../../shared/hooks/use-reduced-motion';
import type { ViewerItem } from './viewer-model';
import {
    mediaTypeLabel,
    viewerClockLabel,
    viewerDateLabel,
} from './viewer-model';

/**
 * The viewer's floating chrome: glass buttons, the sender header, the counter
 * pill and the caption footer. Presentation only — the parent owns the fade
 * clocks, so these components never animate themselves open or closed.
 */

/** Which side the three-dot button sits on; the close button takes the other. */
export const MENU_SIDE: 'start' | 'end' = 'start';

/** Caption footer scrim height above the safe-area inset. */
const FOOTER_FADE = 160;

const GLASS_FILL = 'rgba(20, 10, 40, 0.55)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.14)';

// ── glass button ────────────────────────────────────────────────────────────

export const ViewerGlassButton = memo(function ViewerGlassButton({
    icon: Icon,
    label,
    onPress,
    buttonRef,
    size = 40,
    destructive = false,
}: {
    icon: LucideIcon;
    label: string;
    onPress: () => void;
    buttonRef?: RefObject<ViewInstance | null>;
    size?: number;
    destructive?: boolean;
}): React.ReactElement {
    const reduceMotion = useReducedMotion();
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));
    return (
        <Animated.View style={animatedStyle}>
            <Pressable
                ref={buttonRef}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={onPress}
                onPressIn={(): void => {
                    scale.value = reduceMotion
                        ? 1
                        : withSpring(0.94, { damping: 18, stiffness: 320 });
                }}
                onPressOut={(): void => {
                    scale.value = withSpring(1, {
                        damping: 16,
                        stiffness: 280,
                    });
                }}
                hitSlop={8}
                style={[
                    styles.glassButton,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                    },
                    destructive && styles.glassButtonDanger,
                ]}
            >
                <Icon
                    size={20}
                    strokeWidth={2.2}
                    color={
                        destructive
                            ? palette.semantic.danger
                            : palette.text.primary
                    }
                />
            </Pressable>
        </Animated.View>
    );
});

// ── header ──────────────────────────────────────────────────────────────────

export const ViewerHeader = memo(function ViewerHeader({
    item,
    insetTop,
    onClose,
    onMenu,
    menuButtonRef,
}: {
    item: ViewerItem;
    insetTop: number;
    onClose: () => void;
    onMenu: () => void;
    menuButtonRef: RefObject<ViewInstance | null>;
}): React.ReactElement {
    const menu = (
        <ViewerGlassButton
            icon={MoreHorizontal}
            label="Media actions"
            onPress={onMenu}
            buttonRef={menuButtonRef}
        />
    );
    const close = (
        <ViewerGlassButton
            icon={X}
            label="Close media viewer"
            onPress={onClose}
        />
    );
    return (
        <LinearGradient
            pointerEvents="box-none"
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
            style={[styles.header, { paddingTop: insetTop + spacing.xs }]}
        >
            <View style={styles.headerRow}>
                {MENU_SIDE === 'start' ? menu : close}
                <UserAvatar
                    userId={item.message.senderId}
                    name={item.message.senderName}
                    uri={item.message.senderAvatarPath}
                    size={36}
                />
                <View style={styles.headerText}>
                    <Text style={styles.headerName} numberOfLines={1}>
                        {item.message.senderName}
                    </Text>
                    <Text style={styles.headerDate} numberOfLines={1}>
                        {viewerDateLabel(item.message.createdAtIso)}
                    </Text>
                </View>
                {MENU_SIDE === 'start' ? close : menu}
            </View>
        </LinearGradient>
    );
});

// ── counter ─────────────────────────────────────────────────────────────────

export const ViewerCounter = memo(function ViewerCounter({
    label,
}: {
    label: string;
}): React.ReactElement {
    return (
        <View style={styles.counterPill} pointerEvents="none">
            <Text
                style={styles.counterText}
                accessibilityLiveRegion="polite"
                accessibilityLabel={label}
            >
                {label}
            </Text>
        </View>
    );
});

// ── caption footer ──────────────────────────────────────────────────────────

export const ViewerCaptionFooter = memo(function ViewerCaptionFooter({
    item,
    insetBottom,
    onExpand,
}: {
    item: ViewerItem;
    insetBottom: number;
    onExpand: () => void;
}): React.ReactElement | null {
    const caption = item.message.content?.trim() ?? '';
    if (caption === '') return null;
    const reactions = item.message.reactions;
    return (
        <LinearGradient
            pointerEvents="box-none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.72)']}
            locations={[0, 0.45, 1]}
            style={[
                styles.footer,
                {
                    paddingBottom: insetBottom + spacing.sm,
                    minHeight: insetBottom + FOOTER_FADE,
                },
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Expand caption"
                onPress={onExpand}
            >
                <Text style={styles.caption} numberOfLines={3}>
                    {caption}
                </Text>
            </Pressable>
            <View style={styles.footerMeta}>
                <Text style={styles.footerText}>
                    {mediaTypeLabel(item.attachment)}
                </Text>
                <Text style={styles.footerDot}>·</Text>
                <Text style={styles.footerText}>
                    {viewerClockLabel(item.message.createdAtIso)}
                </Text>
                {reactions.length > 0 && (
                    <View style={styles.reactions}>
                        {reactions.slice(0, 4).map(
                            (reaction): React.ReactElement => (
                                <View
                                    key={reaction.emoji}
                                    style={styles.reactionChip}
                                >
                                    <Text style={styles.reactionText}>
                                        {reaction.emoji} {reaction.count}
                                    </Text>
                                </View>
                            ),
                        )}
                    </View>
                )}
            </View>
        </LinearGradient>
    );
});

// ── expanded caption sheet ──────────────────────────────────────────────────

export const ViewerCaptionSheet = memo(function ViewerCaptionSheet({
    item,
    insetBottom,
    onClose,
}: {
    item: ViewerItem;
    insetBottom: number;
    onClose: () => void;
}): React.ReactElement {
    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close caption"
                onPress={onClose}
                style={styles.sheetBackdrop}
            />
            <View
                accessibilityViewIsModal={true}
                style={[
                    styles.sheet,
                    { paddingBottom: insetBottom + spacing.md },
                ]}
            >
                <View style={styles.sheetGrabber} />
                <ScrollView
                    style={styles.sheetScroll}
                    contentContainerStyle={styles.sheetContent}
                    showsVerticalScrollIndicator={false}
                >
                    <Text selectable={true} style={styles.sheetText}>
                        {item.message.content ?? ''}
                    </Text>
                    <Text style={styles.sheetMeta}>
                        {viewerDateLabel(item.message.createdAtIso)}
                    </Text>
                </ScrollView>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close caption"
                    onPress={onClose}
                    hitSlop={8}
                    style={styles.sheetClose}
                >
                    <Text style={styles.sheetCloseText}>Close</Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    glassButton: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: GLASS_FILL,
        borderWidth: 1,
        borderColor: GLASS_BORDER,
        shadowColor: '#000000',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
    },
    glassButtonDanger: {
        borderColor: 'rgba(255,122,138,0.45)',
    },
    header: {
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.sm,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    headerText: { flex: 1, gap: 1 },
    headerName: {
        color: palette.text.primary,
        fontSize: 15,
        fontWeight: '600',
    },
    headerDate: {
        color: palette.text.secondary,
        fontSize: 12,
        fontWeight: '500',
    },
    counterPill: {
        alignSelf: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radii.full,
        backgroundColor: 'rgba(20, 10, 40, 0.65)',
        borderWidth: 1,
        borderColor: GLASS_BORDER,
    },
    counterText: {
        color: palette.text.primary,
        fontSize: 12,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    footer: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        gap: spacing.xs,
        justifyContent: 'flex-end',
    },
    caption: {
        color: palette.text.primary,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '400',
    },
    footerMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
    },
    footerText: {
        color: palette.text.muted,
        fontSize: 11,
        fontWeight: '500',
        fontVariant: ['tabular-nums'],
    },
    footerDot: { color: palette.text.muted, fontSize: 11 },
    reactions: { flexDirection: 'row', gap: 4, marginStart: 'auto' },
    reactionChip: {
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: radii.full,
        backgroundColor: 'rgba(117,69,184,0.30)',
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.subtle,
    },
    reactionText: { color: palette.text.primary, fontSize: 11 },
    sheetBackdrop: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    sheet: {
        position: 'absolute',
        start: 0,
        end: 0,
        bottom: 0,
        maxHeight: '70%',
        borderTopStartRadius: radii.lg,
        borderTopEndRadius: radii.lg,
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: palette.border.subtle,
        paddingTop: spacing.xs,
        paddingHorizontal: spacing.md,
        gap: spacing.sm,
    },
    sheetGrabber: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: radii.full,
        backgroundColor: palette.border.strong,
    },
    sheetScroll: { flexGrow: 0 },
    sheetContent: { gap: spacing.sm, paddingVertical: spacing.xs },
    sheetText: {
        color: palette.text.primary,
        fontSize: 15,
        lineHeight: 22,
    },
    sheetMeta: { color: palette.text.muted, fontSize: 12 },
    sheetClose: {
        alignSelf: 'flex-end',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        minHeight: 44,
        justifyContent: 'center',
    },
    sheetCloseText: {
        color: palette.primary[600],
        fontSize: 14,
        fontWeight: '600',
    },
});
