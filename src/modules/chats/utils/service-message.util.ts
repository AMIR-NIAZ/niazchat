import { EntityManager } from 'typeorm';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { ChatId } from 'src/common/types/brands.type';
import type { User } from 'src/modules/auth/entities/user.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import type { UserProfile } from 'src/modules/auth/entities/user_profile.entity';
import { TypeMessage } from 'src/modules/messages/entities/typeMessage.entity';
import type { Chat } from '../entities/chat.entity';
import type {
    ServiceMessageAction,
    ServiceMessageMeta,
} from 'src/modules/messages/service-message.types';

export interface CreateServiceMessageInput {
    chatId: ChatId;
    action: ServiceMessageAction;
    /** The user who performed the action (join/leave = the member). */
    actorId: number;
    /** The member the action happened to. */
    targetId: number;
}

/**
 * English fallback sentence stored in `content`. Clients that understand the
 * action rebuild the sentence locally (and localize it); older ones show this.
 */
export function serviceMessageContent(
    action: ServiceMessageAction,
    actorName: string,
    targetName: string,
): string {
    switch (action) {
        case 'member_joined':
            return `${targetName} joined the group`;
        case 'member_joined_via_link':
            return `${targetName} joined via invite link`;
        case 'member_added':
            return `${actorName} added ${targetName}`;
        case 'member_left':
            return `${targetName} left the group`;
        case 'member_banned':
            return `${targetName} was banned`;
        case 'member_removed':
            return `${targetName} was removed`;
    }
}

/**
 * Creates one `system` message INSIDE the caller's transaction, so a
 * membership change and the message that announces it commit together.
 *
 * The returned entity carries the minimal relations the serializers need
 * (`sender.id/profile.name`, `type`, `chat.id`) without a second query.
 */
export async function createServiceMessage(
    manager: EntityManager,
    input: CreateServiceMessageInput,
): Promise<Message> {
    const { chatId, action, actorId, targetId } = input;
    const [actorName, targetName] = await resolveNames(manager, [
        actorId,
        targetId,
    ]);

    const type = await manager
        .getRepository(TypeMessage)
        .findOneOrFail({ where: { name: TypeMessageEnum.SYSTEM } });

    const meta: ServiceMessageMeta = {
        action,
        actorId: Number(actorId),
        actorName,
        targetId: Number(targetId),
        targetName,
    };

    const saved = await manager.getRepository(Message).save({
        content: serviceMessageContent(action, actorName, targetName),
        meta,
        sender: { id: actorId },
        chat: { id: chatId },
        type: { id: type.id },
    });

    // Serializer relations (no extra query): the app renders from `meta`.
    saved.sender = {
        id: actorId,
        profile: { name: actorName },
    } as User & { profile: Partial<UserProfile> };
    saved.type = type;
    saved.chat = { id: chatId } as Chat;

    return saved;
}

/** Display-name snapshots for the actor and the target, in that order. */
async function resolveNames(
    manager: EntityManager,
    ids: number[],
): Promise<[string, string]> {
    const unique = [...new Set(ids.map(Number))].filter(
        (id) => Number.isFinite(id) && id > 0,
    );
    if (unique.length === 0) return ['', ''];
    const rows = await manager.query<
        Array<{ userId: string | number; name: string | null }>
    >(
        `SELECT p."userId" AS "userId", p.name AS name
           FROM user_profiles p
          WHERE p."userId" = ANY($1::bigint[])`,
        [unique],
    );
    const byId = new Map(
        rows.map((row) => [Number(row.userId), row.name ?? ''] as const),
    );
    return [byId.get(Number(ids[0])) ?? '', byId.get(Number(ids[1])) ?? ''];
}
