import * as FileSystem from 'expo-file-system/legacy';

/** In-progress recording kept per chat, so leaving the screen never loses it. */
export interface VoiceDraft {
    uri: string;
    duration: number;
    waveform: number[];
}

const drafts = new Map<number, VoiceDraft>();

export function getVoiceDraft(chatId: number): VoiceDraft | null {
    return drafts.get(chatId) ?? null;
}

export function setVoiceDraft(chatId: number, draft: VoiceDraft): void {
    drafts.set(chatId, draft);
}

/** Removes the draft from the store and returns it (caller owns the file). */
export function takeVoiceDraft(chatId: number): VoiceDraft | null {
    const draft = drafts.get(chatId) ?? null;
    drafts.delete(chatId);
    return draft;
}

/** Removes the draft and deletes its temporary recording file. */
export async function discardVoiceDraft(chatId: number): Promise<void> {
    const draft = drafts.get(chatId);
    drafts.delete(chatId);
    if (draft !== null && draft !== undefined) {
        await FileSystem.deleteAsync(draft.uri, {
            idempotent: true,
        }).catch((): void => undefined);
    }
}
