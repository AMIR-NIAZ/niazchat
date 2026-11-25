import { memo, useCallback } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Link2 } from 'lucide-react-native';
import { radii, spacing } from '../../shared/theme';
import { useTheme, useThemedStyles } from '../../shared/theme/theme-provider';
import type { AppTheme } from '../../shared/theme/theme-provider';
import type { SharedLinkItemDto } from '../../core/api/dto/shared-content.dto';
import { SafeText, UserAvatar } from '../../shared/components';
import { toast } from '../../shared/dialog';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import { sharedDateLabel } from './shared-content-model';

/**
 * One link in the Links tab: the domain is emphasized, the message text around
 * it is a two-line snippet, and the row carries the date (plus the sender in a
 * group). Tap opens the link; long-press copies it.
 *
 * Colours and typography come from the active theme; the row reads it itself
 * so it repaints while memoized.
 */
export const SharedLinkRow = memo(function SharedLinkRow({
    item,
    showSender,
}: {
    item: SharedLinkItemDto;
    showSender: boolean;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);

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
                <Link2 size={18} color={theme.accent} strokeWidth={2} />
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
            <SafeText
                style={styles.date}
                lines={2}
                align="content"
                shrink={false}
            >
                {sharedDateLabel(item.createdAt)}
            </SafeText>
        </Pressable>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
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
            backgroundColor: theme.colors.accentSoft,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
        },
        body: { flex: 1, minWidth: 0, gap: 1 },
        senderLine: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xxs,
            minWidth: 0,
        },
        senderName: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
        },
        domain: {
            ...theme.type.label,
            color: theme.accent,
        },
        snippet: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
        },
        date: {
            ...theme.type.micro,
            color: theme.colors.textMuted,
            width: 74,
            textAlign: 'right',
            fontVariant: ['tabular-nums'],
        },
    });
