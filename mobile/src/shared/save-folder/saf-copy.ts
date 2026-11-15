import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Writing local files into a Storage Access Framework (SAF) directory.
 *
 * Android 11+ forbids writing into the public Download folder directly, and
 * Expo Go has no custom native module, so the only route is the tree URI the
 * user granted through the folder picker: `content://` documents handled by the
 * external-storage provider.
 *
 * No expo-file-system copy API can write a local file into an ALREADY CREATED
 * `content://` document, which is why the copy is done in slices:
 *
 * - legacy `copyAsync` resolves a `file://` source with `Uri.toFile()` on the
 *   destination, so a `content://` target becomes a bogus path;
 * - the new `File.copy` treats an existing SAF document as a collision
 *   (`DestinationAlreadyExistsException`) and, with `overwrite`, deletes it
 *   before writing into the deleted URI.
 *
 * So: `chunked` (2 MB base64 slices appended with `writeAsStringAsync`) is the
 * primary path — bounded memory for any file size — with a one-shot `single`
 * write as the fallback for files under 15 MB. Every path is verified
 * afterwards by comparing the destination size with the source size, and a
 * failed attempt is deleted instead of being left behind.
 */

const SAF = FileSystem.StorageAccessFramework;

/** Base64 slice size: 2 MB of bytes ≈ 2.7 MB of JS string per step. */
const CHUNK_BYTES = 2 * 1024 * 1024;
/** Above this the file is never read into JS memory in one piece. */
const SINGLE_SHOT_MAX_BYTES = 15 * 1024 * 1024;

/** The only provider the legacy SAF helpers accept (`com.android.externalstorage`). */
const LOCAL_PROVIDER = 'content://com.android.externalstorage.documents/';

export type SafCopyMethod = 'chunked' | 'single';

/**
 * True for a URI from the on-device storage provider. Cloud providers (Drive,
 * MTP, archives) are `content://` too, but expo-file-system's SAF writes are
 * limited to external storage, so the folder picker must stay local.
 */
export function isLocalStorageUri(uri: string): boolean {
    return uri.startsWith(LOCAL_PROVIDER);
}

/**
 * Display name of a SAF child URI. Document ids look like
 * `primary:Download/niazChat/photo.jpg`, so the name is the part after the last
 * separator, never the whole URI.
 */
export function safDisplayName(uri: string): string {
    let decoded: string;
    try {
        decoded = decodeURIComponent(uri);
    } catch {
        decoded = uri;
    }
    const path = decoded.includes(':')
        ? decoded.slice(decoded.lastIndexOf(':') + 1)
        : decoded;
    const segments = path.split('/');
    return segments[segments.length - 1] ?? '';
}

/**
 * Children of a granted directory, as `{ uri, name }`. Throws when access was
 * revoked.
 */
export async function listSafChildren(
    dirUri: string,
): Promise<{ uri: string; name: string }[]> {
    const children = await SAF.readDirectoryAsync(dirUri);
    const entries: { uri: string; name: string }[] = [];
    for (const uri of children) {
        const name = safDisplayName(uri);
        if (name !== '') {
            entries.push({ uri, name });
        }
    }
    return entries;
}

/** Creates an empty document and returns its `content://` URI. */
export async function createSafFile(
    dirUri: string,
    fileName: string,
    mimeType: string,
): Promise<string> {
    return SAF.createFileAsync(dirUri, fileName, mimeType);
}

/** Best-effort size of a SAF document, or null when it cannot be read. */
export async function safFileSize(uri: string): Promise<number | null> {
    try {
        const info = new File(uri).info();
        if (info.exists) {
            return info.size ?? null;
        }
    } catch {
        // Fall through to the legacy query below.
    }
    try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) {
            return info.size;
        }
    } catch {
        // Unreadable: reported by the caller as an unknown size.
    }
    return null;
}

/** Removes a half-written document; never throws. */
export async function deleteSafFile(uri: string): Promise<void> {
    try {
        new File(uri).delete();
        return;
    } catch {
        // Try the legacy deleter below.
    }
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
        (): void => undefined,
    );
}

async function copyChunked(
    sourceUri: string,
    destUri: string,
    size: number,
): Promise<void> {
    for (let position = 0; position < size; position += CHUNK_BYTES) {
        const length = Math.min(CHUNK_BYTES, size - position);
        const chunk = await FileSystem.readAsStringAsync(sourceUri, {
            encoding: 'base64',
            position,
            length,
        });
        if (chunk === '') {
            throw new Error('The file could not be read.');
        }
        await FileSystem.writeAsStringAsync(destUri, chunk, {
            encoding: 'base64',
            // SAF opens `wa` for append and truncates on the first write.
            append: position > 0,
        });
    }
}

async function copySingleShot(
    sourceUri: string,
    destUri: string,
): Promise<void> {
    const base64 = await FileSystem.readAsStringAsync(sourceUri, {
        encoding: 'base64',
    });
    await FileSystem.writeAsStringAsync(destUri, base64, {
        encoding: 'base64',
    });
}

/**
 * Copies `sourceUri` (a local `file://` file) into the already-created SAF
 * document `destUri`. Returns which strategy worked. Each attempt starts from
 * an empty destination, so a failed strategy leaves no partial data behind.
 */
export async function copyLocalFileToSaf(
    sourceUri: string,
    destUri: string,
    size: number,
): Promise<SafCopyMethod> {
    try {
        await copyChunked(sourceUri, destUri, size);
        return 'chunked';
    } catch {
        if (size > SINGLE_SHOT_MAX_BYTES) {
            throw new Error('The file could not be copied to that folder.');
        }
        // Small enough for one round trip.
    }
    await copySingleShot(sourceUri, destUri);
    return 'single';
}
