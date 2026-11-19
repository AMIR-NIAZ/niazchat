import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { MemberPermissionOverride } from '../entities/member_permission_override.entity';
import {
    type MemberPermissionOverrideMap,
    type MemberPermissionsConfig,
    normalizeMemberPermissionOverrides,
    normalizeMemberPermissions,
    resolveMemberPermissions,
} from '../utils/member-permissions.util';

/**
 * Single source of truth for INDIVIDUAL member permissions:
 *
 *   effective = memberOverride ?? groupDefault
 *
 * Both authorization paths (`ChatPermissionService`, `ChatAccessService`) and
 * every direct enforcement site resolve through this service, so `allow`,
 * `deny` and `inherit` can never diverge between endpoints. Pass the current
 * `EntityManager` where a row lock is held, so the effective policy is read
 * inside the same transaction.
 */
@Injectable()
export class MemberPermissionResolverService {
    constructor(
        @InjectRepository(MemberPermissionOverride)
        private readonly repository: Repository<MemberPermissionOverride>,
    ) {}

    /** Full tri-state map; missing row/keys normalize to `inherit`. */
    async getOverrides(
        chatId: ChatId,
        userId: UserId,
        manager?: EntityManager,
    ): Promise<MemberPermissionOverrideMap> {
        const repository =
            manager?.getRepository(MemberPermissionOverride) ?? this.repository;
        const row = await repository.findOne({
            where: { chat: { id: chatId }, user: { id: userId } },
        });
        return normalizeMemberPermissionOverrides(row?.overrides);
    }

    /** Effective config for one member of one group. */
    async resolve(
        chat: Pick<Chat, 'id' | 'memberPermissions'>,
        userId: UserId,
        manager?: EntityManager,
    ): Promise<MemberPermissionsConfig> {
        const defaults = normalizeMemberPermissions(chat.memberPermissions);
        const overrides = await this.getOverrides(chat.id, userId, manager);
        return resolveMemberPermissions(defaults, overrides);
    }
}
