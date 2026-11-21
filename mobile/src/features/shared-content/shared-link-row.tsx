import { memo, useCallback } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Link2 } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
import type { SharedLinkItemDto } from '../../core/api/dto/shared-content.dto';
import { SafeText, UserAvatar } from '../../shared/components';
import { toast } from '../../shared/dialog';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import { sharedDateLabel } from './shared-content-model';

/**
 * One link in the Links tab: the domain is emphasized, the message text around
 * it is a two-line snippet, and the row carries the date (plus the sender in a
 * group). Tap opens the link; long-press copies it.
 */
export const SharedLinkRow = memo(function SharedLinkRow({
    item,
    showSender,
}: {
    item: SharedLinkItemDto;
    showSender: boolean;
}): React.ReactElement {
    const open = useCallback((): void => {
        void Linking.openURL(item.url).catch((): void => {
            toast.show('Could not open this link.', { tone: 'danger' });
        });
    }, [item.url]);

    const copy = useCallback((): void => {
        void Clipboard.setStringAsync(item.url).then((): void =>
            toast.show('Link copied'),
        );
    }, [item.url]);

    return (
        <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${item.domain} link. Tap to open, long press to copy.`}
            onPress={open}
            onLongPress={copy}
            delayLongPress={LONG_PRESS_DELAY_MS}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            <View style={styles.icon}>
                <Link2 size={18} color={palette.primary[600]} strokeWidth={2} />
            </View>
            <View style={styles.body}>
                {showSender && (
                    <View style={styles.senderLine}>
                        <UserAvatar
                            userId={item.sender.id}
                            name={item.sender.name || 'Member'}
                            uri={item.sender.avatarUrl}
                            size={18}
                        />
                        <SafeText style={styles.senderName} lines={1}>
                            {item.sender.name || 'Member'}
                        </SafeText>
                    </View>
                )}
                <SafeText style={styles.domain} lines={1}>
                    {item.domain}
                </SafeText>
                {item.snippet !== '' && (
                    <SafeText style={styles.snippet} lines={2}>
                        {item.snippet}
                    </SafeText>
                )}
            </View>
            <Text style={styles.date} numberOfLines={2}>
                {sharedDateLabel(item.createdAt)}
            </Text>
        </Pressable>
    );
});

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        height: 84,
    },
    pressed: { opacity: 0.7 },
    icon: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
    },
    body: { flex: 1, minWidth: 0, gap: 1 },
    senderLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
        minWidth: 0,
    },
    senderName: {
        color: palette.text.secondary,
        fontSize: 11,
        fontWeight: '600',
        flexShrink: 1,
    },
    domain: {
        color: palette.primary[700],
        fontSize: 14,
        fontWeight: '700',
    },
    snippet: {
        color: palette.text.secondary,
        fontSize: 12,
        lineHeight: 16,
    },
    date: {
        color: palette.text.muted,
        fontSize: 10,
        width: 74,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
});
