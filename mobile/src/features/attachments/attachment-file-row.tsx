import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';
import { LONG_PRESS_DELAY_MS } from '../../shared/long-press';
import type { AttachmentView } from '../messages/messages-model';
import { formatFileSize } from './attachment-labels';
import { fileTypeLabel, mimeForFileName, utiForFileName } from './file-name';
import {
    cancelAttachmentDownload,
    downloadAttachment,
    findCachedAttachment,
    isAttachmentDownloadActive,
    shareLocalFile,
} from './file-download';
import { NoViewerAppError } from './file-open-policy';
import { openLocalFile } from './open-file';
import { useUploadProgress } from './upload-progress-store';

type RowState = 'idle' | 'downloading' | 'downloaded' | 'failed';

function iconFor(name: string, mimeType: string): string {
    const mime = mimeType.toLowerCase();
    const type = fileTypeLabel(name, mimeType);
    if (type === 'PDF') return '📄';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.startsWith('video/')) return '🎬';
    if (
        mime.includes('zip') ||
        mime.includes('rar') ||
        mime.includes('7z') ||
        mime.includes('tar') ||
        mime.includes('gzip') ||
        type === 'ZIP'
    ) {
        return '🗜️';
    }
    return '📎';
}

/**
 * One document row. Tap downloads with progress and opens when complete (or
 * opens immediately from cache); a separate button always shares. Long press
 * is forwarded to the message action sheet so the row never swallows it.
 */
export function AttachmentFileRow({
    attachment,
    mine,
    onLongPress,
}: {
    attachment: AttachmentView;
    mine: boolean;
    onLongPress?: (() => void) | undefined;
}): React.ReactElement {
    const [state, setState] = useState<RowState>('idle');
    const [progress, setProgress] = useState(0);
    const [cachedPath, setCachedPath] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const busy = useRef(false);
    const uploadProgress = useUploadProgress(attachment.key);
    const uploading = attachment.status === 'uploading';
    const uploadFailed = attachment.status === 'failed';
    const downloading =
        state === 'downloading' &&
        attachment.id !== null &&
        isAttachmentDownloadActive(attachment.id);
    const percent = Math.round((downloading ? progress : uploadProgress) * 100);

    useEffect((): (() => void) | undefined => {
        let cancelled = false;
        if (attachment.id === null || uploading || uploadFailed) {
            return undefined;
        }
        void findCachedAttachment({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
        }).then((path): void => {
            if (cancelled || path === null) return;
            setCachedPath(path);
            setState('downloaded');
        });
        return (): void => {
            cancelled = true;
        };
    }, [
        attachment.id,
        attachment.name,
        attachment.mimeType,
        uploading,
        uploadFailed,
    ]);

    const openPath = async (path: string): Promise<void> => {
        try {
            await openLocalFile(path, attachment.name, attachment.mimeType);
            setState('downloaded');
            setError(null);
        } catch (caught) {
            if (caught instanceof NoViewerAppError) {
                setState('downloaded');
                setError('No app found to open this file — tap ↗ to share');
                return;
            }
            throw caught;
        }
    };

    const open = async (): Promise<void> => {
        if (attachment.id === null || busy.current || uploading) {
            return;
        }
        busy.current = true;
        try {
            setError(null);
            const cached =
                cachedPath ??
                (await findCachedAttachment({
                    id: attachment.id,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                }));
            if (cached !== null) {
                setCachedPath(cached);
                setState('downloaded');
                await openPath(cached);
                return;
            }

            setState('downloading');
            setProgress(0);
            const path = await downloadAttachment(
                {
                    id: attachment.id,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                },
                (value) => setProgress(value),
            );
            setCachedPath(path);
            setState('downloaded');
            await openPath(path);
        } catch (caught) {
            const message =
                caught instanceof Error ? caught.message : 'Download failed.';
            if (message.toLowerCase().includes('cancel')) {
                setState('idle');
                setProgress(0);
            } else {
                setState('failed');
                setError(message);
            }
        } finally {
            busy.current = false;
        }
    };

    const share = async (): Promise<void> => {
        if (attachment.id === null || busy.current || uploading) {
            return;
        }
        busy.current = true;
        try {
            setError(null);
            const path =
                cachedPath ??
                (await downloadAttachment({
                    id: attachment.id,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                }));
            setCachedPath(path);
            setState('downloaded');
            await shareLocalFile(
                path,
                mimeForFileName(attachment.name, attachment.mimeType),
                attachment.name,
                utiForFileName(attachment.name),
            );
        } catch (caught) {
            setState('failed');
            setError(
                caught instanceof Error ? caught.message : 'Could not share.',
            );
        } finally {
            busy.current = false;
        }
    };

    const onPress = (): void => {
        if (state === 'downloading' && attachment.id !== null) {
            cancelAttachmentDownload(attachment.id);
            setState('idle');
            setProgress(0);
            return;
        }
        if (uploadFailed) {
            return;
        }
        if (!busy.current) {
            void open();
        }
    };

    const actionLabel = downloading
        ? 'Cancel download'
        : state === 'downloaded'
          ? 'Open'
          : state === 'failed'
            ? 'Retry'
            : 'Download';

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${attachment.name}`}
            accessibilityState={{ disabled: uploading || uploadFailed }}
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={LONG_PRESS_DELAY_MS}
            style={styles.row}
        >
            <View style={styles.iconBox}>
                <Text style={[styles.icon, mine && styles.iconMine]}>
                    {iconFor(attachment.name, attachment.mimeType)}
                </Text>
                {(downloading || uploading) && (
                    <View style={styles.iconProgress}>
                        <ActivityIndicator
                            size="small"
                            color={
                                mine ? palette.neutral[0] : palette.primary[600]
                            }
                        />
                    </View>
                )}
                {!downloading && !uploading && (
                    <Text
                        style={[
                            styles.iconBadge,
                            mine && styles.iconBadgeMine,
                            state === 'failed' && styles.iconBadgeFailed,
                        ]}
                    >
                        {state === 'downloaded'
                            ? '↗'
                            : state === 'failed'
                              ? '↻'
                              : '↓'}
                    </Text>
                )}
            </View>

            <View style={styles.meta}>
                <Text
                    style={[styles.name, mine && styles.nameMine]}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {attachment.name}
                </Text>
                <Text
                    style={[styles.size, mine && styles.sizeMine]}
                    numberOfLines={1}
                >
                    {uploading
                        ? `Uploading ${percent}%`
                        : downloading
                          ? `Downloading ${percent}%`
                          : uploadFailed
                            ? (attachment.error ?? 'Upload failed')
                            : `${fileTypeLabel(
                                  attachment.name,
                                  attachment.mimeType,
                              )} · ${formatFileSize(attachment.size)}`}
                </Text>
                {error !== null && (
                    <Text
                        style={[styles.error, mine && styles.errorMine]}
                        numberOfLines={2}
                    >
                        {error}
                    </Text>
                )}
                {(downloading || uploading) && (
                    <View style={styles.track}>
                        <View
                            style={[
                                styles.fill,
                                { width: `${Math.min(100, percent)}%` },
                            ]}
                        />
                    </View>
                )}
            </View>

            {attachment.id !== null && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Share ${attachment.name}`}
                    accessibilityState={{ disabled: uploading || uploadFailed }}
                    onPress={(): void => {
                        if (!uploading && !uploadFailed) void share();
                    }}
                    onLongPress={onLongPress}
                    delayLongPress={LONG_PRESS_DELAY_MS}
                    hitSlop={8}
                    style={styles.shareButton}
                >
                    <Text
                        style={[styles.shareIcon, mine && styles.shareIconMine]}
                    >
                        ↗
                    </Text>
                </Pressable>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        minWidth: 200,
        maxWidth: '100%',
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.sm,
    },
    iconBox: {
        width: 40,
        height: 40,
        borderRadius: radii.sm,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    icon: { fontSize: 24, color: palette.neutral[700] },
    iconMine: { color: palette.neutral[0] },
    iconProgress: {
        position: 'absolute',
        right: 2,
        bottom: 2,
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconBadge: {
        position: 'absolute',
        right: 0,
        bottom: -1,
        color: palette.primary[700],
        fontSize: 11,
        fontWeight: '700',
    },
    iconBadgeMine: { color: palette.primary[100] },
    iconBadgeFailed: { color: palette.semantic.danger },
    meta: { flex: 1, minWidth: 0, gap: 1 },
    name: {
        color: palette.neutral[900],
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'left',
        writingDirection: 'auto',
        flexShrink: 1,
    },
    nameMine: { color: palette.neutral[0] },
    size: { color: palette.neutral[500], fontSize: 11 },
    sizeMine: { color: palette.primary[100] },
    error: { color: palette.semantic.danger, fontSize: 10 },
    errorMine: { color: palette.primary[100] },
    shareButton: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    shareIcon: {
        color: palette.primary[600],
        fontSize: 18,
        fontWeight: '700',
    },
    shareIconMine: { color: palette.neutral[0] },
    track: {
        height: 3,
        borderRadius: radii.full,
        backgroundColor: 'rgba(255,255,255,0.35)',
        overflow: 'hidden',
        marginTop: 2,
    },
    fill: { height: '100%', backgroundColor: palette.primary[300] },
});
