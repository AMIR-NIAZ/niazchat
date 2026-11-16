import * as Clipboard from 'expo-clipboard';
import {
    Copy,
    Download,
    Forward,
    Info,
    MessageSquare,
    Share2,
    Trash2,
} from 'lucide-react-native';
import { Platform } from 'react-native';
import type { ContextMenuItem } from '../../../shared/context-popup';
import { dialog, toast } from '../../../shared/dialog';
import { getLocalVideoUri } from '../../../shared/media-cache';
import { saveFileToDownloads } from '../../../shared/save-folder';
import { downloadAttachment, shareLocalFile } from '../file-download';
import { extensionForMime, sanitizeFileName } from '../file-name';
import type { ViewerItem } from './viewer-model';
import { viewerInfoLines } from './viewer-model';

/**
 * The viewer's three-dot menu: DATA only. It is rendered by the shared context
 * popup host (anchored under the button), so the rows, sizing and animation
 * stay identical to the message and chat menus.
 *
 * Share/Save/Copy/Info are implemented here; Forward, Go to message and Delete
 * are the conversation's existing flows, handed in by the screen.
 */

export interface ViewerMenuHandlers {
    onForward: (item: ViewerItem) => void;
    onGoToMessage: (item: ViewerItem) => void;
    onDelete: (item: ViewerItem) => void;
    /** False hides Delete (no permission, pending upload, already deleted). */
    canDelete: boolean;
}

/**
 * Local `file://` path of the full-size file. Videos share only their verified
 * download; an image is fetched through the authenticated download route (and
 * cached) because the viewer may be showing it from expo-image's cache only.
 */
async function resolveLocalFile(item: ViewerItem): Promise<string | null> {
    const { attachment } = item;
    if (attachment.id === null) {
        return attachment.localUri ?? null;
    }
    if (attachment.kind === 'video') {
        return getLocalVideoUri(attachment.id);
    }
    try {
        return await downloadAttachment({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
        });
    } catch {
        return null;
    }
}

async function shareItem(item: ViewerItem): Promise<void> {
    const path = await resolveLocalFile(item);
    if (path === null) {
        toast.show('Download the file first.', { tone: 'warning' });
        return;
    }
    try {
        await shareLocalFile(
            path,
            item.attachment.mimeType,
            item.attachment.name,
        );
    } catch (error) {
        toast.show(
            error instanceof Error ? error.message : 'Could not share.',
            { tone: 'danger' },
        );
    }
}

/** Above this the save runs behind a spinner so a long copy is visible. */
const LARGE_SAVE_BYTES = 8 * 1024 * 1024;

/** `niazChat_20261115_143012.jpg` for attachments with no original name. */
function timestampedSaveName(mimeType: string): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const extension = extensionForMime(mimeType);
    return `niazChat_${stamp}${extension === '' ? '' : `.${extension}`}`;
}

/** Original name when the message carries one, else a timestamped one. */
function saveNameFor(item: ViewerItem): string {
    const { attachment } = item;
    if (attachment.name.trim() !== '') {
        return sanitizeFileName(
            attachment.name,
            attachment.id ?? 0,
            attachment.mimeType,
        );
    }
    return timestampedSaveName(attachment.mimeType);
}

/**
 * Android: write into the folder the user granted once, through the Storage
 * Access Framework (see `shared/save-folder`). Never opens the share sheet, and
 * retries from the error dialog when a step fails.
 */
async function saveToDownloads(item: ViewerItem, path: string): Promise<void> {
    const result = await saveFileToDownloads({
        sourceUri: path,
        fileName: saveNameFor(item),
        mimeType: item.attachment.mimeType,
    });
    if (result.status === 'saved') {
        toast.show(`Saved to ${result.label}`);
        return;
    }
    if (result.status === 'cancelled') {
        toast.show('Save cancelled');
        return;
    }
    dialog.show({
        title: 'Could not save',
        message: result.message,
        tone: 'danger',
        buttons: [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Retry',
                onPress: (): void => {
                    void saveItem(item);
                },
            },
        ],
    });
}

/**
 * Save. Android writes into `Download/niazChat` (no share sheet). iOS has no
 * `expo-media-library` in this build, so the file still goes to the system sheet
 * where "Save to Photos" keeps a copy. Never throws into the UI.
 */
async function saveItem(item: ViewerItem): Promise<void> {
    const path = await resolveLocalFile(item);
    if (path === null) {
        toast.show('Download the file first.', { tone: 'warning' });
        return;
    }
    if (Platform.OS === 'android') {
        if (item.attachment.size >= LARGE_SAVE_BYTES) {
            // The button spinner is the progress state while the copy runs.
            dialog.show({
                title: 'Saving',
                message: 'Copying the file to your Downloads folder…',
                tone: 'info',
                cancelable: false,
                buttons: [
                    {
                        text: 'Saving…',
                        onPress: async (): Promise<void> => {
                            await saveToDownloads(item, path);
                        },
                    },
                ],
            });
            return;
        }
        await saveToDownloads(item, path);
        return;
    }
    try {
        await shareLocalFile(
            path,
            item.attachment.mimeType,
            item.attachment.name,
        );
        toast.show('Choose “Save to Photos” to keep a copy.');
    } catch (error) {
        toast.show(
            error instanceof Error
                ? error.message
                : 'The photo library is not available on this device.',
            { tone: 'danger' },
        );
    }
}

async function copyCaption(item: ViewerItem): Promise<void> {
    const text = item.message.content?.trim() ?? '';
    if (text === '') return;
    try {
        await Clipboard.setStringAsync(text);
        toast.show('Copied');
    } catch {
        toast.show('Could not copy.', { tone: 'danger' });
    }
}

function showInfo(item: ViewerItem): void {
    dialog.alert('Media info', viewerInfoLines(item).join('\n'));
}

export function buildViewerMenuItems(
    item: ViewerItem,
    handlers: ViewerMenuHandlers,
    /** False for a video that is not downloaded yet (Share/Save wait for it). */
    fileReady: boolean,
): ContextMenuItem[] {
    const caption = item.message.content?.trim() ?? '';
    const items: ContextMenuItem[] = [];

    items.push({
        id: 'share',
        label: 'Share',
        icon: Share2,
        disabled: !fileReady,
        ...(fileReady ? {} : { hint: 'Download first' }),
        onPress: (): void => {
            void shareItem(item);
        },
    });
    items.push({
        id: 'save',
        label:
            Platform.OS === 'android' ? 'Save to Downloads' : 'Save to gallery',
        icon: Download,
        disabled: !fileReady,
        ...(fileReady ? {} : { hint: 'Download first' }),
        onPress: (): void => {
            void saveItem(item);
        },
    });
    items.push({
        id: 'forward',
        label: 'Forward',
        icon: Forward,
        onPress: (): void => handlers.onForward(item),
    });
    if (item.message.id !== null) {
        items.push({
            id: 'goto',
            label: 'Go to message',
            icon: MessageSquare,
            onPress: (): void => handlers.onGoToMessage(item),
        });
    }
    if (caption !== '') {
        items.push({
            id: 'copy',
            label: 'Copy caption',
            icon: Copy,
            onPress: (): void => {
                void copyCaption(item);
            },
        });
    }
    if (handlers.canDelete) {
        items.push({
            id: 'delete',
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            onPress: (): void => handlers.onDelete(item),
        });
    }
    items.push({
        id: 'info',
        label: 'Info',
        icon: Info,
        onPress: (): void => showInfo(item),
    });
    return items;
}
