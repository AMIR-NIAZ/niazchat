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
import type { ContextMenuItem } from '../../../shared/context-popup';
import { dialog, toast } from '../../../shared/dialog';
import { getLocalVideoUri } from '../../../shared/media-cache';
import { downloadAttachment, shareLocalFile } from '../file-download';
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
        await shareLocalFile(path, item.attachment.mimeType, item.attachment.name);
    } catch (error) {
        toast.show(
            error instanceof Error ? error.message : 'Could not share.',
            { tone: 'danger' },
        );
    }
}

/**
 * Save to gallery. `expo-media-library` is not part of this build, so the file
 * is handed to the system share sheet, where "Save to Photos"/"Save to
 * Files" writes it to the gallery. Never throws into the UI.
 */
async function saveItem(item: ViewerItem): Promise<void> {
    const path = await resolveLocalFile(item);
    if (path === null) {
        toast.show('Download the file first.', { tone: 'warning' });
        return;
    }
    try {
        await shareLocalFile(path, item.attachment.mimeType, item.attachment.name);
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
        label: 'Save to gallery',
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
