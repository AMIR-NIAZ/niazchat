import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { dialog } from '../dialog';
import { isLocalStorageUri, listSafChildren, safDisplayName } from './saf-copy';

/**
 * The folder media is saved into on Android, granted once through the Storage
 * Access Framework.
 *
 * Android 11+ blocks direct writes to the public Download folder and Expo Go
 * cannot ship a MediaStore module, so the user grants a tree URI once. That
 * grant is persistent (`takePersistableUriPermission` inside expo-file-system)
 * and survives restarts; it can still be revoked from system settings, so it is
 * re-verified on every save and dropped when it no longer lists.
 *
 * Files land in `niazChat` inside the granted folder (normally Download):
 * picked Download → `Download/niazChat/photo.jpg`.
 */

const SAF = FileSystem.StorageAccessFramework;

/** SecureStore key: `expo-secure-store` is the app's only storage dependency. */
const SAVE_FOLDER_KEY = 'niazchat.saveFolder.v1';

/** Child folder created inside the granted tree. */
export const SAVE_FOLDER_NAME = 'niazChat';

/** Where the picker starts: the device's Download folder. */
const DOWNLOAD_HINT = 'Download';

const EXPLANATION =
    "Pick the Downloads folder, create a folder named niazChat (or select it if it exists), then tap 'Use this folder'. Files will be saved there from now on.";

export interface SaveFolder {
    /** Tree URI the user granted (the Download folder, normally). */
    grantUri: string;
    /** Directory files are written into: `niazChat`, or the grant itself. */
    targetUri: string;
    /** Human label for messages and a future Settings row. */
    label: string;
}

function parseFolder(raw: string | null): SaveFolder | null {
    if (raw === null) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
        const record = parsed as Record<string, unknown>;
        const grantUri = record.grantUri;
        const targetUri = record.targetUri;
        const label = record.label;
        if (
            typeof grantUri !== 'string' ||
            typeof targetUri !== 'string' ||
            typeof label !== 'string' ||
            !isLocalStorageUri(grantUri)
        ) {
            return null;
        }
        return { grantUri, targetUri, label };
    } catch {
        return null;
    }
}

async function writeFolder(folder: SaveFolder): Promise<void> {
    try {
        await SecureStore.setItemAsync(
            SAVE_FOLDER_KEY,
            JSON.stringify(folder),
        );
    } catch {
        // Storage unavailable: the folder still works for this session.
    }
}

/**
 * The remembered save folder, WITHOUT touching the filesystem — cheap enough
 * for a Settings row ("Save folder: Download/niazChat"). Null until the user
 * granted one. Verifying that it still exists is part of the save flow.
 */
export async function getSaveFolder(): Promise<SaveFolder | null> {
    try {
        return parseFolder(await SecureStore.getItemAsync(SAVE_FOLDER_KEY));
    } catch {
        return null;
    }
}

/** Forgets the grant, so the next save asks for a folder again. */
export async function resetSaveFolder(): Promise<void> {
    try {
        await SecureStore.deleteItemAsync(SAVE_FOLDER_KEY);
    } catch {
        // Nothing to forget.
    }
}

/** Name of the granted folder as the user sees it, e.g. `Download`. */
function grantName(grantUri: string): string {
    const name = safDisplayName(grantUri);
    return name === '' ? 'the chosen folder' : name;
}

/**
 * Maps a granted tree URI to the directory files actually go into: the
 * `niazChat` child, created on first use and reused afterwards. Throws when the
 * grant was revoked or the folder was deleted.
 */
async function resolveTarget(grantUri: string): Promise<SaveFolder> {
    const parent = grantName(grantUri);
    if (parent.toLowerCase() === SAVE_FOLDER_NAME.toLowerCase()) {
        return { grantUri, targetUri: grantUri, label: parent };
    }
    const children = await listSafChildren(grantUri);
    const existing = children.find(
        (child) => child.name.toLowerCase() === SAVE_FOLDER_NAME.toLowerCase(),
    );
    const targetUri =
        existing === undefined
            ? await SAF.makeDirectoryAsync(grantUri, SAVE_FOLDER_NAME)
            : existing.uri;
    return {
        grantUri,
        targetUri,
        label: `${parent}/${SAVE_FOLDER_NAME}`,
    };
}

/** Asks the user for a folder, with the one-time explanation first. */
export async function requestSaveFolder(): Promise<SaveFolder | null> {
    const confirmed = await dialog.confirm({
        title: 'Choose a save folder',
        message: EXPLANATION,
        confirmText: 'Choose folder',
        cancelText: 'Cancel',
    });
    if (!confirmed) {
        return null;
    }
    let granted: FileSystem.FileSystemRequestDirectoryPermissionsResult;
    try {
        granted = await SAF.requestDirectoryPermissionsAsync(
            SAF.getUriForDirectoryInRoot(DOWNLOAD_HINT),
        );
    } catch {
        throw new Error('The folder picker could not be opened.');
    }
    if (!granted.granted) {
        return null;
    }
    if (!isLocalStorageUri(granted.directoryUri)) {
        throw new Error(
            'Choose a folder on this device (Download works best). Cloud folders cannot be written to.',
        );
    }
    const folder = await resolveTarget(granted.directoryUri);
    await writeFolder(folder);
    return folder;
}

/**
 * The folder to save into right now: the remembered one when it still works,
 * otherwise a fresh picker run. Null means the user cancelled.
 */
export async function ensureSaveFolder(): Promise<SaveFolder | null> {
    const stored = await getSaveFolder();
    if (stored !== null) {
        try {
            const target = await resolveTarget(stored.grantUri);
            if (
                target.targetUri !== stored.targetUri ||
                target.label !== stored.label
            ) {
                await writeFolder(target);
            }
            return target;
        } catch {
            // Revoked permission or a deleted folder: ask again.
            await resetSaveFolder();
        }
    }
    return requestSaveFolder();
}
