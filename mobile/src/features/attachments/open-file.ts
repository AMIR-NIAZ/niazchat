import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { NoViewerAppError, selectOpenStrategy } from './file-open-policy';
import { mimeForFileName, utiForFileName } from './file-name';
import { shareLocalFile } from './file-download';

export interface OpenFileResult {
    how: 'android-view' | 'share';
}

/**
 * Android: content:// URI + ACTION_VIEW with read permission. iOS: the system
 * share sheet (no QuickLook API is available in the installed Expo modules).
 * Blocklisted executables/installers are only shared, never launched.
 */
export async function openLocalFile(
    path: string,
    fileName: string,
    mimeType: string | null | undefined,
): Promise<OpenFileResult> {
    const decision = selectOpenStrategy(Platform.OS, fileName);
    if (decision.strategy === 'share') {
        await shareLocalFile(
            path,
            mimeForFileName(fileName, mimeType),
            fileName,
            utiForFileName(fileName),
        );
        return { how: 'share' };
    }

    const contentUri = await FileSystem.getContentUriAsync(path);
    try {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            type: mimeForFileName(fileName, mimeType),
            // FLAG_GRANT_READ_URI_PERMISSION
            flags: 1,
        });
    } catch {
        throw new NoViewerAppError();
    }
    return { how: 'android-view' };
}
