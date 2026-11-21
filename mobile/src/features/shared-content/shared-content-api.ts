import { request } from '../../core/socket';
import { socketOrThrow } from '../chats/chats-socket-api';
import type {
    SharedAttachmentItemDto,
    SharedContentPageDto,
    SharedContentType,
    SharedLinkItemDto,
} from '../../core/api/dto/shared-content.dto';

/**
 * WebSocket API for the chat profile's shared content.
 *
 * One acked request per page; the server verifies chat membership, excludes
 * messages deleted for the caller and for everyone, and returns a stable
 * cursor. Tabs are independent, so opening one never fetches the others.
 */

/** Newest-first page of attachment-backed content. */
export function fetchChatMedia(
    chatId: number,
    type: Exclude<SharedContentType, 'links'>,
    cursor?: string,
    limit?: number,
): Promise<SharedContentPageDto<SharedAttachmentItemDto>> {
    return requestPage<SharedAttachmentItemDto>(chatId, type, cursor, limit);
}

/** Newest-first page of extracted links. */
export function fetchChatLinks(
    chatId: number,
    cursor?: string,
    limit?: number,
): Promise<SharedContentPageDto<SharedLinkItemDto>> {
    return requestPage<SharedLinkItemDto>(chatId, 'links', cursor, limit);
}

async function requestPage<T>(
    chatId: number,
    type: SharedContentType,
    cursor?: string,
    limit?: number,
): Promise<SharedContentPageDto<T>> {
    const payload: {
        chatId: number;
        type: SharedContentType;
        cursor?: string;
        limit?: number;
    } = { chatId, type };
    if (cursor !== undefined && cursor !== null && cursor !== '') {
        payload.cursor = cursor;
    }
    if (limit !== undefined) {
        payload.limit = limit;
    }
    const page = await request<SharedContentPageDto<T>>(
        socketOrThrow(),
        'getChatMedia',
        payload,
    );
    return page ?? { items: [], nextCursor: null };
}
