import { isBlockedDocumentName } from './file-name';

export class NoViewerAppError extends Error {
    constructor() {
        super('No app found to open this file');
        this.name = 'NoViewerAppError';
    }
}

export type OpenStrategy = 'android-view' | 'share';

export interface OpenDecision {
    strategy: OpenStrategy;
    /** Why Share was selected instead of an Android VIEW intent. */
    reason: 'blocked' | 'ios' | 'android' | null;
}

/**
 * Executable/installer extensions are NEVER handed to an Android VIEW intent.
 * iOS has no QuickLook API in the installed Expo modules, so its "open" is the
 * system share sheet (which includes "Open in…").
 */
export function selectOpenStrategy(
    platform: string,
    fileName: string,
): OpenDecision {
    if (isBlockedDocumentName(fileName)) {
        return { strategy: 'share', reason: 'blocked' };
    }
    if (platform === 'android') {
        return { strategy: 'android-view', reason: 'android' };
    }
    return { strategy: 'share', reason: 'ios' };
}
