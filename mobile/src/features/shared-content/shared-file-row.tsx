import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { radii, spacing } from '../../shared/theme';
import { useTheme, useThemedStyles } from '../../shared/theme/theme-provider';
import type { AppTheme } from '../../shared/theme/theme-provider';
import type { SharedAttachmentItemDto } from '../../core/api/dto/shared-content.dto';
import { SafeText, UserAvatar } from '../../shared/components';
import { formatFileSize } from '../attachments/attachment-labels';
import { sharedDateLabel } from './shared-content-model';

/** One generic file (documents, archives, anything not media/audio). */
export const SharedFileRow = memo(function SharedFileRow({
    item,
    showSender,
}: {
    item: SharedAttachmentItemDto;
    showSender: boolean;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const attachment = item.attachment;
    return (
        <View style={styles.row}>
            <View style={styles.icon}>
                <FileText size={18} color={theme.accent} strokeWidth={2} />
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
                <SafeText style={styles.name} lines={1}>
                    {attachment.originalName}
                </SafeText>
                <SafeText style={styles.meta}>
                    {formatFileSize(attachment.size)}
                </SafeText>
            </View>
            <SafeText
                style={styles.date}
                lines={2}
                align="content"
                shrink={false}
            >
                {sharedDateLabel(item.createdAt)}
            </SafeText>
        </View>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            height: 74,
        },
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
        name: {
            ...theme.type.label,
            color: theme.colors.text,
        },
        meta: {
            ...theme.type.micro,
            fontWeight: '400',
            color: theme.colors.textMuted,
        },
        date: {
            ...theme.type.micro,
            color: theme.colors.textMuted,
            width: 74,
            textAlign: 'right',
            fontVariant: ['tabular-nums'],
        },
    });
