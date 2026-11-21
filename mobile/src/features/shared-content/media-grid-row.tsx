import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { palette, radii, spacing } from '../../shared/theme';
import type { SharedAttachmentItemDto } from '../../core/api/dto/shared-content.dto';
import { attachmentPreviewUrl, useAttachmentAuth } from '../attachments';
import { formatDuration, hasDuration } from '../attachments/duration';

/**
 * One row of the 3-column square grid.
 *
 * Only the server-generated thumbnail is requested (`/preview?size=360`), and
 * the same `cacheKey` lets expo-image reuse the disk cache between visits.
 * Videos show their poster plus a centered play glyph and duration badge; the
 * full file is never loaded here, only by the viewer.
 */
export const MediaGridRow = memo(function MediaGridRow({
    items,
    tileSize,
    gap,
    onOpen,
}: {
    items: readonly SharedAttachmentItemDto[];
    tileSize: number;
    gap: number;
    onOpen: (item: SharedAttachmentItemDto) => void;
}): React.ReactElement {
    const { headers } = useAttachmentAuth();
    return (
        <View style={[styles.row, { gap }]}>
            {items.map((item) => (
                <MediaTile
                    key={item.attachment.id}
                    item={item}
                    size={tileSize}
                    headers={headers}
                    onOpen={onOpen}
                />
            ))}
            {/* Keep a short last row aligned to the 3-column grid. */}
            {Array.from({ length: 3 - items.length }, (_, index) => (
                <View
                    key={`filler-${index}`}
                    style={{ width: tileSize, height: tileSize }}
                />
            ))}
        </View>
    );
});

function MediaTile({
    item,
    size,
    headers,
    onOpen,
}: {
    item: SharedAttachmentItemDto;
    size: number;
    headers: Record<string, string> | undefined;
    onOpen: (item: SharedAttachmentItemDto) => void;
}): React.ReactElement {
    const attachment = item.attachment;
    const isVideo = attachment.kind === 'video';
    const duration = attachment.duration;
    const uri = attachmentPreviewUrl(attachment.id, 360);
    const label = `${isVideo ? 'Video' : 'Photo'}${
        hasDuration(duration) ? `, ${formatDuration(duration)}` : ''
    }`;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={(): void => onOpen(item)}
            style={({ pressed }) => [
                styles.tile,
                { width: size, height: size },
                pressed && styles.pressed,
            ]}
        >
            <Image
                source={{
                    uri,
                    cacheKey: `att-${attachment.id}-thumb`,
                    ...(headers !== undefined ? { headers } : {}),
                }}
                cachePolicy="memory-disk"
                contentFit="cover"
                transition={120}
                recyclingKey={`att-${attachment.id}`}
                style={styles.image}
            />
            {isVideo && (
                <View style={styles.videoOverlay} pointerEvents="none">
                    <View style={styles.playCircle}>
                        <Play
                            size={16}
                            color="#FFFFFF"
                            strokeWidth={2.4}
                            fill="#FFFFFF"
                        />
                    </View>
                    {hasDuration(duration) && (
                        <View style={styles.durationBadge}>
                            <Text style={styles.durationText}>
                                {formatDuration(duration)}
                            </Text>
                        </View>
                    )}
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
    },
    tile: {
        borderRadius: radii.sm,
        overflow: 'hidden',
        backgroundColor: palette.neutral[100],
    },
    pressed: { opacity: 0.72 },
    image: { width: '100%', height: '100%' },
    videoOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(12, 16, 20, 0.52)',
    },
    durationBadge: {
        position: 'absolute',
        right: 5,
        bottom: 5,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: radii.sm,
        backgroundColor: 'rgba(12, 16, 20, 0.62)',
    },
    durationText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
});
