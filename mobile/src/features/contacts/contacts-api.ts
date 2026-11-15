import { ApiError, httpClient } from '../../core/api';
import { absoluteUploadUrl } from '../../core/config/env';
import type { SavedContactItem } from './contacts-model';

/**
 * Saved contacts API (docs/mobile-api/contacts.md#saved-contacts).
 *
 * `GET /contacts` answers a bare `{ items }`; create/rename answer one item
 * and delete answers `{ message }`. Avatars may already be absolute (the
 * server builds them from the request origin); `absoluteUploadUrl` passes
 * those through unchanged.
 */

interface SavedContactDto {
    id: number;
    userId: number;
    alias: string | null;
    name: string;
    username: string | null;
    avatars: string[];
    phone?: string;
}

export interface CreateContactPayload {
    userId?: number;
    username?: string;
    phone?: string;
    alias?: string | null;
}

export function toSavedContactItem(dto: SavedContactDto): SavedContactItem {
    const avatar = dto.avatars?.[0];
    return {
        id: Number(dto.id),
        userId: Number(dto.userId),
        alias: dto.alias ?? null,
        name: dto.name,
        username: dto.username ?? null,
        avatarUrl: avatar === undefined ? null : absoluteUploadUrl(avatar),
        phone: typeof dto.phone === 'string' ? dto.phone : null,
    };
}

function normalize(dto: SavedContactDto): SavedContactItem {
    return toSavedContactItem({
        ...dto,
        id: Number(dto.id),
        userId: Number(dto.userId),
    });
}

export async function fetchSavedContacts(): Promise<SavedContactItem[]> {
    const response = await httpClient.get<{ items?: SavedContactDto[] }>(
        '/contacts',
    );
    return (response.data.items ?? []).map((item) => normalize(item));
}

export async function createContact(
    payload: CreateContactPayload,
): Promise<SavedContactItem> {
    const body: CreateContactPayload = { ...payload };
    if (body.alias !== undefined) {
        const alias = body.alias?.trim() ?? '';
        if (alias === '') {
            delete body.alias;
        } else {
            body.alias = alias.slice(0, 60);
        }
    }
    const response = await httpClient.post<SavedContactDto>('/contacts', body);
    return normalize(response.data);
}

export async function renameContact(
    id: number,
    alias: string | null,
): Promise<SavedContactItem> {
    const trimmed = alias?.trim() ?? '';
    const response = await httpClient.patch<SavedContactDto>(
        `/contacts/${id}`,
        { alias: trimmed === '' ? null : trimmed.slice(0, 60) },
    );
    return normalize(response.data);
}

export async function removeContact(id: number): Promise<void> {
    await httpClient.delete(`/contacts/${id}`);
}

/** User-safe message for a failed save/rename/remove. */
export function describeSavedContactError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 404:
                return error.message;
            case 400:
                return error.message;
            case 409:
                return 'Already in your contacts';
            case 429:
                return 'Too many requests, try again in a minute.';
            case 401:
                return 'Session expired. Please sign in again.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Something went wrong. Try again.';
}
