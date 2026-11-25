import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { CustomAppBackground } from './appearance-types';

/**
 * Local storage for the single app background image.
 *
 * - The picked photo is resized to at most 1600 px on its long edge and
 *   re-encoded as JPEG before it is written to the documents directory (never
 *   cached, never uploaded). A small 300 px copy is written next to it for the
 *   appearance picker's thumbnail.
 * - Every pick gets a unique file name (`bg-<timestamp>.jpg`). expo-image keys
 *   its cache by URI, so a fixed name would keep showing the old (or a blank)
 *   bitmap after a replacement.
 * - The returned `uri` / `thumbnailUri` are the final `file://` paths, and both
 *   files are verified to exist before they are handed to the store.
 *
 * This file uses expo-file-system's legacy `documentDirectory` API throughout
 * (the `expo-file-system/legacy` entry point); the new `File`/`Directory` API
 * is not mixed in here.
 */

const MAX_LONG_EDGE = 1600;
const THUMBNAIL_WIDTH = 300;
const JPEG_QUALITY = 0.8;
const THUMBNAIL_QUALITY = 0.7;

/** Always ends with a slash; `documentDirectory` itself does too. */
const DOCUMENT_DIRECTORY = FileSystem.documentDirectory;
const DIRECTORY =
    DOCUMENT_DIRECTORY === null ? null : `${DOCUMENT_DIRECTORY}app-background/`;

/** v1 stored copies here; removed once the new file is in place. */
const LEGACY_DIRECTORY =
    DOCUMENT_DIRECTORY === null
        ? null
        : `${DOCUMENT_DIRECTORY}chat-backgrounds/`;

function filePath(name: string): string {
    return `${DIRECTORY ?? ''}${name}`;
}

/**
 * Saves a picked image (plus its thumbnail) under a fresh unique name and
 * returns the paths to persist. Throws when the copy could not be verified, so
 * the caller can surface an error instead of storing a URI that renders blank.
 */
export async function persistAppBackgroundImage(
    uri: string,
    width?: number,
    height?: number,
): Promise<CustomAppBackground> {
    if (DIRECTORY === null) {
        // No documents directory on this platform (web): keep the picked URI
        // rather than failing the whole flow.
        return { id: `bg-${Date.now()}`, uri, thumbnailUri: uri };
    }
    await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });

    const id = `bg-${Date.now()}`;
    const fullTarget = filePath(`${id}.jpg`);
    const thumbnailTarget = filePath(`${id}-thumb.jpg`);

    const sourceWidth = typeof width === 'number' && width > 0 ? width : 0;
    const sourceHeight = typeof height === 'number' && height > 0 ? height : 0;
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const fullResize =
        longEdge > MAX_LONG_EDGE
            ? sourceWidth >= sourceHeight
                ? { width: MAX_LONG_EDGE }
                : { height: MAX_LONG_EDGE }
            : null;
    const thumbnailResize =
        sourceWidth > 0 && sourceHeight > 0 && sourceWidth < sourceHeight
            ? { height: THUMBNAIL_WIDTH }
            : { width: THUMBNAIL_WIDTH };

    // Always re-encode: normalized orientation, predictable size on disk.
    const full = await manipulateAsync(
        uri,
        fullResize === null ? [] : [{ resize: fullResize }],
        { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
    );
    const thumbnail = await manipulateAsync(
        uri,
        [{ resize: thumbnailResize }],
        { compress: THUMBNAIL_QUALITY, format: SaveFormat.JPEG },
    );

    await FileSystem.copyAsync({ from: full.uri, to: fullTarget });
    await FileSystem.copyAsync({ from: thumbnail.uri, to: thumbnailTarget });

    // `copyAsync` can resolve without a usable file; never store a dead URI.
    const [fullInfo, thumbnailInfo] = await Promise.all([
        FileSystem.getInfoAsync(fullTarget),
        FileSystem.getInfoAsync(thumbnailTarget),
    ]);
    if (!fullInfo.exists || !thumbnailInfo.exists) {
        await Promise.all([
            FileSystem.deleteAsync(fullTarget, { idempotent: true }).catch(
                (): void => undefined,
            ),
            FileSystem.deleteAsync(thumbnailTarget, {
                idempotent: true,
            }).catch((): void => undefined),
        ]);
        throw new Error('The background image could not be saved');
    }

    return { id, uri: fullTarget, thumbnailUri: thumbnailTarget };
}

/**
 * Deletes one stored gallery image (replaced by a new pick, or removed by the
 * user). Never touches anything when the file is already gone.
 */
export async function removeAppBackgroundImage(
    image: CustomAppBackground,
): Promise<void> {
    const targets = new Set([image.uri, image.thumbnailUri]);
    await Promise.all(
        [...targets].map((target) =>
            FileSystem.deleteAsync(target, { idempotent: true }).catch(
                (): void => undefined,
            ),
        ),
    );
}

/** Deletes every stored background file (reset to default). */
export async function removeAllAppBackgroundImages(): Promise<void> {
    if (DIRECTORY !== null) {
        await FileSystem.deleteAsync(DIRECTORY, { idempotent: true }).catch(
            (): void => undefined,
        );
    }
    if (LEGACY_DIRECTORY !== null) {
        await FileSystem.deleteAsync(LEGACY_DIRECTORY, {
            idempotent: true,
        }).catch((): void => undefined);
    }
}

/**
 * A missing file (user cleared app data, restored a backup…) silently falls
 * back to the default background.
 */
export async function appBackgroundFileExists(uri: string): Promise<boolean> {
    if (!uri.startsWith('file://')) {
        return true;
    }
    try {
        const info = await FileSystem.getInfoAsync(uri);
        return info.exists;
    } catch {
        return false;
    }
}
