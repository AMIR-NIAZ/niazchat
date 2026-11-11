import { httpClient } from '../../core/api';
import type {
    InviteCreateInput,
    InviteLinkDto,
    InviteLinksPage,
    InvitePreview,
    JoinInviteResult,
} from './invite-links-model';

/**
 * Invite-link REST surface (docs/mobile-api/groups.md):
 *   GET    /chats/:chatId/invite-links
 *   POST   /chats/:chatId/invite-links
 *   DELETE /chats/:chatId/invite-links/:linkId
 *   GET    /invites/:code
 *   POST   /invites/:code/join
 *
 * Ids are normalized to numbers here, once.
 */

function number(value: unknown): number {
    return Number(value);
}

function toInviteLink(raw: InviteLinkDto): InviteLinkDto {
    return {
        id: number(raw.id),
        code: String(raw.code ?? ''),
        status: raw.status,
        createdBy: {
            userId:
                raw.createdBy?.userId === null ||
                raw.createdBy?.userId === undefined
                    ? null
                    : number(raw.createdBy.userId),
            name: raw.createdBy?.name ?? '',
        },
        createdAt: String(raw.createdAt ?? ''),
        expiresAt: raw.expiresAt ?? null,
        maxUses:
            raw.maxUses === null || raw.maxUses === undefined
                ? null
                : number(raw.maxUses),
        usesCount: number(raw.usesCount) || 0,
        revokedAt: raw.revokedAt ?? null,
    };
}

export async function fetchInviteLinks(
    chatId: number,
): Promise<InviteLinksPage> {
    const response = await httpClient.get<InviteLinksPage>(
        `/chats/${chatId}/invite-links`,
    );
    return {
        items: (response.data.items ?? []).map(toInviteLink),
        activeCount: number(response.data.activeCount) || 0,
        maxActive: number(response.data.maxActive) || 10,
    };
}

export async function createInviteLink(
    chatId: number,
    input: InviteCreateInput,
): Promise<InviteLinkDto> {
    const response = await httpClient.post<InviteLinkDto>(
        `/chats/${chatId}/invite-links`,
        input,
    );
    return toInviteLink(response.data);
}

export async function revokeInviteLink(
    chatId: number,
    linkId: number,
): Promise<{ id: number; status: 'revoked'; changed: boolean }> {
    const response = await httpClient.delete<{
        id: number;
        status: 'revoked';
        changed: boolean;
    }>(`/chats/${chatId}/invite-links/${linkId}`);
    return {
        id: number(response.data.id),
        status: 'revoked',
        changed: response.data.changed === true,
    };
}

export async function previewInvite(code: string): Promise<InvitePreview> {
    const response = await httpClient.get<InvitePreview>(
        `/invites/${encodeURIComponent(code)}`,
    );
    return {
        title: response.data.title ?? '',
        description: response.data.description ?? null,
        avatar: response.data.avatar ?? null,
        membersCount: number(response.data.membersCount) || 0,
        alreadyMember: response.data.alreadyMember === true,
        chatId:
            response.data.chatId === null || response.data.chatId === undefined
                ? null
                : number(response.data.chatId),
    };
}

export async function joinInvite(code: string): Promise<JoinInviteResult> {
    const response = await httpClient.post<JoinInviteResult>(
        `/invites/${encodeURIComponent(code)}/join`,
    );
    return {
        chatId: number(response.data.chatId),
        title: response.data.title ?? '',
        joined: response.data.joined === true,
        alreadyMember: response.data.alreadyMember === true,
    };
}
