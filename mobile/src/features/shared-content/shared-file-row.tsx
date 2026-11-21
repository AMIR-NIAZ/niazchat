import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
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
    const attachment = item.attachment;
    return (
        <View style={styles.row}>
            <View style={styles.icon}>
                <FileText
                    size={18}
                    color={palette.primary[600]}
                    strokeWidth={2}
                />
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
                <Text style={styles.meta}>
                    {formatFileSize(attachment.size)}
                </Text>
            </View>
            <Text style={styles.date} numberOfLines={2}>
                {sharedDateLabel(item.createdAt)}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create({
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
    name: {
        color: palette.text.primary,
        fontSize: 14,
        fontWeight: '600',
    },
    meta: { color: palette.text.muted, fontSize: 11 },
    date: {
        color: palette.text.muted,
        fontSize: 10,
        width: 74,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
});
