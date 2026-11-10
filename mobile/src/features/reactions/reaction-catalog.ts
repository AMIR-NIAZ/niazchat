import { useQuery } from '@tanstack/react-query';
import { httpClient } from '../../core/api';
import type { ReactionTypeDto } from '../../core/api';

/**
 * Reaction catalog (`GET /react`). The server is authoritative; the fixed
 * fallback keeps the quick bar usable when the request fails (offline, API
 * restart) and is never mixed into a successfully loaded catalog.
 */
export const DEFAULT_REACTION_EMOJIS = [
    '👍',
    '❤️',
    '😂',
    '😮',
    '😢',
    '🙏',
] as const;

export const REACTIONS_QUERY_KEY = ['reactions'] as const;
const CATALOG_STALE_TIME_MS = 30 * 60 * 1000;

/**
 * Canonical comparison key: the same emoji may arrive with or without the
 * variation selector and surrounding whitespace. Sent emojis always come from
 * the catalog, so normalizing only for comparisons is enough.
 */
export function normalizeEmoji(emoji: string): string {
    return emoji.replace(/\uFE0F/g, '').replace(/\s+/g, '');
}

function toEmojiList(rows: ReactionTypeDto[]): string[] {
    const seen = new Set<string>();
    const emojis: string[] = [];
    for (const row of rows) {
        if (typeof row?.emoji !== 'string' || row.emoji.trim() === '') {
            continue;
        }
        const key = normalizeEmoji(row.emoji);
        if (key === '' || seen.has(key)) {
            continue;
        }
        seen.add(key);
        emojis.push(row.emoji);
    }
    return emojis;
}

export async function fetchReactionCatalog(): Promise<string[]> {
    const response = await httpClient.get<
        ReactionTypeDto[] | { data?: ReactionTypeDto[] }
    >('/react');
    const payload = response.data;
    const rows = Array.isArray(payload) ? payload : (payload?.data ?? []);
    return toEmojiList(rows);
}

/** Cached emoji list with the constant fallback when unavailable. */
export function useReactionEmojis(): string[] {
    const query = useQuery<string[]>({
        queryKey: REACTIONS_QUERY_KEY,
        queryFn: fetchReactionCatalog,
        staleTime: CATALOG_STALE_TIME_MS,
        retry: 1,
    });
    const emojis = query.data ?? [];
    return emojis.length > 0 ? emojis : [...DEFAULT_REACTION_EMOJIS];
}
