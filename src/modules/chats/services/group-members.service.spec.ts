import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    NotFoundException,
} from '@nestjs/common';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { PermissionChat } from '../entities/permission_chat.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { ChatPermissionService } from './chat-permission.service';
import type { ChatCallerContext } from './chat-permission.service';
import { GroupMembersService } from './group-members.service';
import { decodeMemberCursor } from '../utils/group-members.util';

interface BuilderRows {
    callerRows: ChatMember[];
    targetRows: ChatMember[];
}

function memberRow(
    id: number,
    userId: number,
    roleName: RoleChatEnum,
    chatId = 1,
): ChatMember {
    return {
        id,
        user: { id: userId },
        chat: {
            id: chatId,
            type: TypeChatEnum.GRUPE,
            isBan: false,
            title: 'Group',
            avatars: ['uploads/avatars/a.png', 'uploads/avatars/b.png'],
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        role: { id: 1, name: roleName },
    } as unknown as ChatMember;
}

function callerContext(
    overrides: Partial<ChatCallerContext> = {},
): ChatCallerContext {
    return {
        chat: {
            id: 1,
            type: TypeChatEnum.GRUPE,
            isBan: false,
            title: 'Group',
            avatars: [],
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        } as never,
        member: memberRow(100, 2, RoleChatEnum.MANAGER),
        memberIds: [100],
        roleName: RoleChatEnum.MANAGER,
        role: 'owner',
        permissions: [],
        isOwner: true,
        isAdmin: false,
        ...overrides,
    };
}

function buildHarness(options: {
    caller?: ChatCallerContext;
    targetRow?: ChatMember | null;
    rows?: BuilderRows;
    grants?: Array<{ permission: { name: string } }>;
    permissionRows?: Array<{ id: number; name: string }>;
    rateConsume?: jest.Mock;
    lookupRows?: ChatMember[];
}) {
    const caller = options.caller ?? callerContext();
    const targetRow =
        options.targetRow === undefined
            ? memberRow(10, 7, RoleChatEnum.USER)
            : options.targetRow;
    const rows: BuilderRows = options.rows ?? {
        callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
        targetRows: targetRow === null ? [] : [targetRow],
    };

    const updates: Array<{ criteria: unknown; patch: unknown }> = [];
    const deletes: Array<{ entity: string; criteria: unknown }> = [];
    const inserts: unknown[] = [];

    // Both query builders share one queue: the first locked query is the
    // caller, the second is the target.
    const queue: ChatMember[][] = [rows.callerRows, rows.targetRows];
    const makeBuilder = (): {
        innerJoinAndSelect: () => unknown;
        where: () => unknown;
        andWhere: () => unknown;
        setLock: () => unknown;
        getMany: () => Promise<ChatMember[]>;
    } => {
        const builder = {
            innerJoinAndSelect: (): unknown => builder,
            where: (): unknown => builder,
            andWhere: (): unknown => builder,
            setLock: (): unknown => builder,
            getMany: (): Promise<ChatMember[]> =>
                Promise.resolve(queue.shift() ?? []),
        };
        return builder;
    };

    const manager = {
        query: (sql: string, params?: unknown[]): Promise<unknown> => {
            if (sql.includes('UPDATE "chat_members"')) {
                updates.push({
                    criteria: params?.[1],
                    patch: params?.[0],
                });
            }
            return Promise.resolve([]);
        },
        getRepository: (entity: unknown) => {
            if (entity === ChatMember) {
                return {
                    createQueryBuilder: makeBuilder,
                    update: (
                        criteria: unknown,
                        patch: unknown,
                    ): Promise<void> => {
                        updates.push({ criteria, patch });
                        return Promise.resolve();
                    },
                    delete: (criteria: unknown): Promise<void> => {
                        deletes.push({ entity: 'chat_members', criteria });
                        return Promise.resolve();
                    },
                };
            }
            if (entity === PermissionAdmin) {
                return {
                    find: (): Promise<unknown[]> =>
                        Promise.resolve(options.grants ?? []),
                    delete: (criteria: unknown): Promise<void> => {
                        deletes.push({ entity: 'permission_admin', criteria });
                        return Promise.resolve();
                    },
                    insert: (payload: unknown): Promise<void> => {
                        inserts.push(payload);
                        return Promise.resolve();
                    },
                };
            }
            if (entity === PermissionChat) {
                const rows = options.permissionRows ?? [
                    { id: 1, name: PermissionChatEnum.BAN_USER },
                    { id: 2, name: PermissionChatEnum.DELETE_MESSAGE },
                    { id: 3, name: PermissionChatEnum.CHANGE_INFO_CHAT },
                ];
                return {
                    find: (args?: {
                        where?: { name?: { _value?: unknown } };
                    }): Promise<unknown[]> => {
                        const names = args?.where?.name?._value;
                        return Promise.resolve(
                            Array.isArray(names)
                                ? rows.filter((row) => names.includes(row.name))
                                : rows,
                        );
                    },
                };
            }
            if (entity === RoleChat) {
                return {
                    findOne: ({
                        where,
                    }: {
                        where: { name: RoleChatEnum };
                    }): Promise<unknown> =>
                        Promise.resolve({
                            id: where.name === RoleChatEnum.ADMIN ? 2 : 1,
                            name: where.name,
                        }),
                };
            }
            throw new Error('unexpected repository');
        },
    };

    const memberRepository = {
        findOne: (): Promise<ChatMember | null> => Promise.resolve(targetRow),
        find: (): Promise<ChatMember[]> =>
            Promise.resolve(
                options.lookupRows ?? (targetRow === null ? [] : [targetRow]),
            ),
        query: jest.fn(
            (sql: string, params?: unknown[]): Promise<unknown[]> => {
                void sql;
                void params;
                return Promise.resolve([]);
            },
        ),
    };
    const permissionService = new ChatPermissionService(
        {} as never,
        {} as never,
    );
    jest.spyOn(permissionService, 'getCallerContext').mockResolvedValue(caller);
    const realtime = {
        memberRoleChanged: jest.fn(),
        memberPermissionsChanged: jest.fn(),
        memberRemoved: jest.fn((): Promise<void> => Promise.resolve()),
        membersCountChanged: jest.fn(),
    };
    const rateLimit = {
        consume:
            options.rateConsume ??
            jest.fn((): Promise<number> => Promise.resolve(1)),
    };
    const dataSource = {
        transaction: <T>(run: (manager: unknown) => Promise<T>): Promise<T> =>
            run(manager),
    };

    const service = new GroupMembersService(
        memberRepository as never,
        {} as never,
        dataSource as never,
        permissionService,
        realtime as never,
        rateLimit as never,
        {
            find: (): Promise<unknown[]> =>
                Promise.resolve(options.grants ?? []),
            delete: (criteria: unknown): Promise<void> => {
                deletes.push({ entity: 'permission_admin', criteria });
                return Promise.resolve();
            },
            insert: (payload: unknown): Promise<void> => {
                inserts.push(payload);
                return Promise.resolve();
            },
        } as never,
    );

    return {
        service,
        memberRepository,
        permissionService,
        realtime,
        rateLimit,
        updates,
        deletes,
        inserts,
    };
}

function deleteValues(criteria: unknown): number[] {
    const value = criteria as {
        member?: { id?: { _value?: unknown } };
        id?: { _value?: unknown };
    };
    const operator = value.member?.id ?? value.id;
    return Array.isArray(operator?._value) ? (operator._value as number[]) : [];
}

function expectDeletedValues(
    deletes: Array<{ entity: string; criteria: unknown }>,
    entity: string,
    expected: number[],
): void {
    const entry = deletes.find((item) => item.entity === entity);
    expect(entry).toBeDefined();
    expect(deleteValues(entry?.criteria)).toEqual(expected);
}

describe('GroupMembersService actions', () => {
    it('owner promotes a member and grants the default permissions', async () => {
        const harness = buildHarness({});
        const result = await harness.service.promoteMember(
            1 as never,
            10,
            2 as never,
        );

        expect(result).toEqual({ memberId: 10, role: 'admin', changed: true });
        expect(harness.updates).toHaveLength(1);
        expectDeletedValues(harness.deletes, 'permission_admin', [10]);
        expect(harness.inserts).toHaveLength(1);
        expect((harness.inserts[0] as unknown[]).length).toBe(3);
        expect(harness.realtime.memberRoleChanged).toHaveBeenCalledWith(1, 7);
    });

    it('promoting an admin again is an idempotent no-op', async () => {
        const target = memberRow(10, 7, RoleChatEnum.ADMIN);
        const harness = buildHarness({
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [target],
            },
        });
        const result = await harness.service.promoteMember(
            1 as never,
            10,
            2 as never,
        );

        expect(result).toEqual({ memberId: 10, role: 'admin', changed: false });
        expect(harness.updates).toHaveLength(0);
        expect(harness.realtime.memberRoleChanged).not.toHaveBeenCalled();
    });

    it('owner demotes an admin and deletes every permission grant', async () => {
        const target = memberRow(10, 7, RoleChatEnum.ADMIN);
        const harness = buildHarness({
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [target],
            },
        });
        const result = await harness.service.demoteMember(
            1 as never,
            10,
            2 as never,
        );

        expect(result).toEqual({ memberId: 10, role: 'member', changed: true });
        expectDeletedValues(harness.deletes, 'permission_admin', [10]);
        expect(harness.realtime.memberRoleChanged).toHaveBeenCalledWith(1, 7);
    });

    it('demoting a member again is an idempotent no-op', async () => {
        const target = memberRow(10, 7, RoleChatEnum.USER);
        const harness = buildHarness({
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [target],
            },
        });
        const result = await harness.service.demoteMember(
            1 as never,
            10,
            2 as never,
        );

        expect(result).toEqual({
            memberId: 10,
            role: 'member',
            changed: false,
        });
        expect(harness.updates).toHaveLength(0);
    });

    it('removal deletes ALL duplicate rows and their permissions', async () => {
        const first = memberRow(10, 7, RoleChatEnum.USER);
        const second = memberRow(11, 7, RoleChatEnum.USER);
        const harness = buildHarness({
            targetRow: first,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [first, second],
            },
        });
        const result = await harness.service.removeMember(
            1 as never,
            10,
            2 as never,
        );

        expect(result).toEqual({ memberId: 10, role: null, changed: true });
        expectDeletedValues(harness.deletes, 'chat_members', [10, 11]);
        expectDeletedValues(harness.deletes, 'permission_admin', [10, 11]);
        expect(harness.realtime.memberRemoved).toHaveBeenCalledWith(1, 7);
    });

    it('an admin with ban_user may remove a regular member', async () => {
        const target = memberRow(10, 7, RoleChatEnum.USER);
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
                permissions: [PermissionChatEnum.BAN_USER],
            }),
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.ADMIN)],
                targetRows: [target],
            },
            grants: [{ permission: { name: PermissionChatEnum.BAN_USER } }],
        });
        const result = await harness.service.removeMember(
            1 as never,
            10,
            2 as never,
        );

        expect(result.changed).toBe(true);
    });

    it('an admin without ban_user cannot remove a member', async () => {
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
                permissions: [PermissionChatEnum.DELETE_MESSAGE],
            }),
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.ADMIN)],
                targetRows: [memberRow(10, 7, RoleChatEnum.USER)],
            },
            grants: [
                { permission: { name: PermissionChatEnum.DELETE_MESSAGE } },
            ],
        });

        await expect(
            harness.service.removeMember(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(harness.deletes).toHaveLength(0);
    });

    it('an admin can never promote, demote or remove another admin', async () => {
        for (const operation of ['promote', 'demote', 'remove'] as const) {
            const target = memberRow(
                10,
                7,
                operation === 'promote'
                    ? RoleChatEnum.USER
                    : RoleChatEnum.ADMIN,
            );
            const harness = buildHarness({
                caller: callerContext({
                    role: 'admin',
                    roleName: RoleChatEnum.ADMIN,
                    isOwner: false,
                    isAdmin: true,
                    permissions: [PermissionChatEnum.ALL],
                }),
                targetRow: target,
                rows: {
                    callerRows: [memberRow(100, 2, RoleChatEnum.ADMIN)],
                    targetRows: [target],
                },
                grants: [{ permission: { name: PermissionChatEnum.ALL } }],
            });
            const run =
                operation === 'promote'
                    ? harness.service.promoteMember(1 as never, 10, 2 as never)
                    : operation === 'demote'
                      ? harness.service.demoteMember(1 as never, 10, 2 as never)
                      : harness.service.removeMember(
                            1 as never,
                            10,
                            2 as never,
                        );
            await expect(run).rejects.toBeInstanceOf(ForbiddenException);
        }
    });

    it('nobody can touch the owner', async () => {
        const target = memberRow(10, 7, RoleChatEnum.MANAGER);
        const harness = buildHarness({
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [target],
            },
        });
        await expect(
            harness.service.removeMember(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nobody can act on themselves', async () => {
        const target = memberRow(100, 2, RoleChatEnum.MANAGER);
        const harness = buildHarness({
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [target],
            },
        });
        await expect(
            harness.service.removeMember(1 as never, 100, 2 as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a member id from another chat is rejected with 404', async () => {
        const harness = buildHarness({ targetRow: null });
        await expect(
            harness.service.promoteMember(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(harness.updates).toHaveLength(0);
    });

    it('a private chat answers 400 before any mutation', async () => {
        const harness = buildHarness({
            caller: callerContext({
                chat: {
                    id: 1,
                    type: TypeChatEnum.PRIVATE,
                    isBan: false,
                    avatars: [],
                } as never,
            }),
        });
        await expect(
            harness.service.removeMember(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a concurrent removal answers 409 instead of 500', async () => {
        const harness = buildHarness({
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [],
            },
        });
        await expect(
            harness.service.removeMember(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('enforces the per-user rate limit before the transaction', async () => {
        const consume = jest.fn((): Promise<number> => {
            throw new HttpException('Too many group actions', 429);
        });
        const harness = buildHarness({ rateConsume: consume });
        await expect(
            harness.service.promoteMember(1 as never, 10, 2 as never),
        ).rejects.toMatchObject({ status: 429 });
        expect(harness.updates).toHaveLength(0);
    });
});

describe('GroupMembersService permissions', () => {
    const adminTarget = (): ChatMember => memberRow(10, 7, RoleChatEnum.ADMIN);
    const grant = (name: PermissionChatEnum) => ({
        permission: { name },
    });

    it('owner reads the admin permission set and available options', async () => {
        const target = adminTarget();
        const harness = buildHarness({
            targetRow: target,
            lookupRows: [target],
            grants: [
                grant(PermissionChatEnum.BAN_USER),
                grant(PermissionChatEnum.DELETE_MESSAGE),
                grant(PermissionChatEnum.CHANGE_INFO_CHAT),
            ],
        });

        const result = await harness.service.getMemberPermissions(
            1 as never,
            10,
            2 as never,
        );

        expect(result).toMatchObject({
            memberId: 10,
            userId: 7,
            role: 'admin',
            hasAll: false,
            granted: [
                PermissionChatEnum.BAN_USER,
                PermissionChatEnum.DELETE_MESSAGE,
                PermissionChatEnum.CHANGE_INFO_CHAT,
            ],
        });
        expect(result.available.map((option) => option.key)).toEqual([
            'ban_user',
            'delete_message',
            'change_info_chat',
        ]);
        expect(result.available.map((option) => option.label)).toEqual([
            'Remove members',
            'Delete messages',
            'Edit group info',
        ]);
    });

    it('a legacy all grant is reported as all three plus hasAll', async () => {
        const target = adminTarget();
        const harness = buildHarness({
            targetRow: target,
            lookupRows: [target],
            grants: [grant(PermissionChatEnum.ALL)],
        });

        const result = await harness.service.getMemberPermissions(
            1 as never,
            10,
            2 as never,
        );
        expect(result.hasAll).toBe(true);
        expect(result.granted).toEqual([
            PermissionChatEnum.BAN_USER,
            PermissionChatEnum.DELETE_MESSAGE,
            PermissionChatEnum.CHANGE_INFO_CHAT,
        ]);
    });

    it('admins, members and outsiders cannot read permissions', async () => {
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
            }),
        });
        await expect(
            harness.service.getMemberPermissions(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a plain member target is rejected with 409', async () => {
        const target = memberRow(10, 7, RoleChatEnum.USER);
        const harness = buildHarness({
            targetRow: target,
            lookupRows: [target],
        });
        await expect(
            harness.service.getMemberPermissions(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('a member id from another chat is rejected with 404', async () => {
        const harness = buildHarness({ targetRow: null });
        await expect(
            harness.service.getMemberPermissions(1 as never, 10, 2 as never),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces the set with an empty array and removes every grant', async () => {
        const target = adminTarget();
        const harness = buildHarness({
            targetRow: target,
            grants: [
                grant(PermissionChatEnum.BAN_USER),
                grant(PermissionChatEnum.DELETE_MESSAGE),
            ],
        });

        const result = await harness.service.updateMemberPermissions(
            1 as never,
            10,
            2 as never,
            [],
        );

        expect(result).toEqual({ memberId: 10, granted: [], changed: true });
        expectDeletedValues(harness.deletes, 'permission_admin', [10]);
        expect(harness.inserts).toHaveLength(0);
        expect(harness.realtime.memberPermissionsChanged).toHaveBeenCalledWith(
            1,
            7,
        );
    });

    it('saving the same set is an idempotent no-op', async () => {
        const target = adminTarget();
        const harness = buildHarness({
            targetRow: target,
            grants: [
                grant(PermissionChatEnum.BAN_USER),
                grant(PermissionChatEnum.DELETE_MESSAGE),
                grant(PermissionChatEnum.CHANGE_INFO_CHAT),
            ],
        });

        const result = await harness.service.updateMemberPermissions(
            1 as never,
            10,
            2 as never,
            ['ban_user', 'delete_message', 'change_info_chat'],
        );

        expect(result.changed).toBe(false);
        expect(harness.deletes).toHaveLength(0);
        expect(harness.inserts).toHaveLength(0);
        expect(
            harness.realtime.memberPermissionsChanged,
        ).not.toHaveBeenCalled();
    });

    it('adds one missing permission and keeps a canonical grant row', async () => {
        const target = adminTarget();
        const harness = buildHarness({ targetRow: target, grants: [] });

        const result = await harness.service.updateMemberPermissions(
            1 as never,
            10,
            2 as never,
            ['ban_user'],
        );

        expect(result).toEqual({
            memberId: 10,
            granted: ['ban_user'],
            changed: true,
        });
        expectDeletedValues(harness.deletes, 'permission_admin', [10]);
        expect(harness.inserts).toHaveLength(1);
        expect(harness.inserts[0]).toEqual([
            { member: { id: 10 }, permission: { id: 1 } },
        ]);
    });

    it('converts a legacy all row into the explicit selected set', async () => {
        const target = adminTarget();
        const harness = buildHarness({
            targetRow: target,
            grants: [grant(PermissionChatEnum.ALL)],
        });

        const result = await harness.service.updateMemberPermissions(
            1 as never,
            10,
            2 as never,
            ['ban_user', 'delete_message', 'change_info_chat'],
        );

        expect(result.changed).toBe(true);
        expectDeletedValues(harness.deletes, 'permission_admin', [10]);
        expect(harness.inserts).toHaveLength(1);
        expect((harness.inserts[0] as unknown[]).length).toBe(3);
    });

    it('applies the set to duplicate rows through one canonical grant set', async () => {
        const first = memberRow(10, 7, RoleChatEnum.ADMIN);
        const second = memberRow(11, 7, RoleChatEnum.ADMIN);
        const harness = buildHarness({
            targetRow: first,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [first, second],
            },
            grants: [grant(PermissionChatEnum.BAN_USER)],
        });

        const result = await harness.service.updateMemberPermissions(
            1 as never,
            10,
            2 as never,
            ['delete_message'],
        );

        expect(result.memberId).toBe(10);
        expectDeletedValues(harness.deletes, 'permission_admin', [10, 11]);
        expect(harness.inserts[0]).toEqual([
            { member: { id: 10 }, permission: { id: 2 } },
        ]);
    });

    it('answers 409 when the target was demoted while saving', async () => {
        const target = adminTarget();
        const harness = buildHarness({
            targetRow: target,
            rows: {
                callerRows: [memberRow(100, 2, RoleChatEnum.MANAGER)],
                targetRows: [memberRow(10, 7, RoleChatEnum.USER)],
            },
        });

        await expect(
            harness.service.updateMemberPermissions(
                1 as never,
                10,
                2 as never,
                [],
            ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(harness.deletes).toHaveLength(0);
    });

    it('rejects a target that is not an admin with 409', async () => {
        const harness = buildHarness({
            targetRow: memberRow(10, 7, RoleChatEnum.USER),
        });
        await expect(
            harness.service.updateMemberPermissions(
                1 as never,
                10,
                2 as never,
                ['ban_user'],
            ),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a target from another chat with 404', async () => {
        const harness = buildHarness({ targetRow: null });
        await expect(
            harness.service.updateMemberPermissions(
                1 as never,
                10,
                2 as never,
                [],
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('non-owners cannot write permissions', async () => {
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
            }),
        });
        await expect(
            harness.service.updateMemberPermissions(
                1 as never,
                10,
                2 as never,
                [],
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('enforces the permission-change rate limit before the transaction', async () => {
        const consume = jest.fn((): Promise<number> => {
            throw new HttpException('Too many permission changes', 429);
        });
        const harness = buildHarness({
            targetRow: adminTarget(),
            rateConsume: consume,
        });
        await expect(
            harness.service.updateMemberPermissions(
                1 as never,
                10,
                2 as never,
                [],
            ),
        ).rejects.toMatchObject({ status: 429 });
        expect(harness.deletes).toHaveLength(0);
    });

    it('removing ban_user makes canRemove false on the next members request', async () => {
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
                permissions: [],
            }),
        });
        harness.memberRepository.query.mockResolvedValue([
            {
                memberId: '9',
                userId: '7',
                role: 'member',
                rank: '1',
                name: 'Member',
                username: 'member',
                avatars: [],
                isOnline: false,
                lastSeen: null,
            },
        ]);

        const page = await harness.service.getMembers(
            1 as never,
            2 as never,
            {},
        );
        expect(page.items[0]?.actions).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: false,
            canEditPermissions: false,
        });
    });

    it('owner sees Edit permissions only on an admin row', async () => {
        const harness = buildHarness({ caller: callerContext() });
        harness.memberRepository.query.mockResolvedValue([
            {
                memberId: '10',
                userId: '7',
                role: 'admin',
                rank: '2',
                name: 'Admin',
                username: 'admin',
                avatars: [],
                isOnline: false,
                lastSeen: null,
            },
        ]);

        const page = await harness.service.getMembers(
            1 as never,
            2 as never,
            {},
        );
        expect(page.items[0]?.actions).toEqual({
            canPromote: false,
            canDemote: true,
            canRemove: true,
            canEditPermissions: true,
        });
    });
});

describe('GroupMembersService reads', () => {
    it('returns group info with a distinct member count and owner', async () => {
        const harness = buildHarness({});
        harness.memberRepository.query.mockImplementation(
            (sql: string): Promise<unknown[]> =>
                Promise.resolve(
                    sql.includes('COUNT')
                        ? [{ count: '4' }]
                        : [{ userId: 2, name: 'Owner', username: 'owner' }],
                ),
        );

        const info = await harness.service.getGroupInfo(1 as never, 2 as never);

        expect(info).toMatchObject({
            id: 1,
            title: 'Group',
            description: null,
            membersCount: 4,
            myRole: 'owner',
            owner: { userId: 2, name: 'Owner', username: 'owner' },
            capabilities: {
                canEditInfo: true,
                canManageInviteLinks: true,
            },
        });
    });

    it('computes canEditInfo from the caller permissions', async () => {
        const admin = callerContext({
            role: 'admin',
            roleName: RoleChatEnum.ADMIN,
            isOwner: false,
            isAdmin: true,
            permissions: [PermissionChatEnum.CHANGE_INFO_CHAT],
        });
        const withPermission = buildHarness({ caller: admin });
        withPermission.memberRepository.query.mockImplementation(
            (sql: string): Promise<unknown[]> =>
                Promise.resolve(
                    sql.includes('COUNT')
                        ? [{ count: '2' }]
                        : [{ userId: 2, name: 'Owner', username: 'owner' }],
                ),
        );
        const allowed = await withPermission.service.getGroupInfo(
            1 as never,
            2 as never,
        );
        expect(allowed.capabilities).toEqual({
            canEditInfo: true,
            canManageInviteLinks: true,
        });

        const withoutPermission = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
                permissions: [PermissionChatEnum.DELETE_MESSAGE],
            }),
        });
        withoutPermission.memberRepository.query.mockResolvedValue([]);
        const denied = await withoutPermission.service.getGroupInfo(
            1 as never,
            2 as never,
        );
        expect(denied.capabilities).toEqual({
            canEditInfo: false,
            // Any admin may manage links; only info editing needs the grant.
            canManageInviteLinks: true,
        });
    });

    it('lists members ordered by rank, excludes bans, paginates by keyset and computes actions', async () => {
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
                permissions: [PermissionChatEnum.BAN_USER],
            }),
        });
        harness.memberRepository.query.mockResolvedValue([
            {
                memberId: '2',
                userId: '1',
                role: 'owner',
                rank: '3',
                name: 'Owner',
                username: 'owner',
                avatars: ['uploads/avatars/o.png'],
                isOnline: true,
                lastSeen: null,
            },
            {
                memberId: '3',
                userId: '2',
                role: 'admin',
                rank: '2',
                name: 'Me',
                username: 'me',
                avatars: [],
                isOnline: false,
                lastSeen: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                memberId: '9',
                userId: '7',
                role: 'member',
                rank: '1',
                name: 'Member',
                username: 'member',
                avatars: ['a.png', 'b.png'],
                isOnline: false,
                lastSeen: null,
            },
        ]);

        const page = await harness.service.getMembers(1 as never, 2 as never, {
            limit: 2,
        });

        const sql = harness.memberRepository.query.mock.calls[0]?.[0];
        expect(sql).toContain(`r.name <> 'ban'`);
        expect(sql).toContain('ROW_NUMBER() OVER');
        expect(sql).toContain('ORDER BY "rank" DESC, "memberId" ASC');

        expect(page.items).toHaveLength(2);
        expect(page.items[0]).toMatchObject({
            memberId: 2,
            role: 'owner',
            actions: {
                canPromote: false,
                canDemote: false,
                canRemove: false,
                canEditPermissions: false,
            },
        });
        expect(page.items[1]).toMatchObject({
            memberId: 3,
            role: 'admin',
            actions: {
                canPromote: false,
                canDemote: false,
                canRemove: false,
                canEditPermissions: false,
            },
        });
        expect(decodeMemberCursor(page.nextCursor ?? '')).toEqual({
            rank: 2,
            memberId: 3,
        });
    });

    it('computes remove-only actions for an admin with ban_user on a member', async () => {
        const harness = buildHarness({
            caller: callerContext({
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
                isOwner: false,
                isAdmin: true,
                permissions: [PermissionChatEnum.BAN_USER],
            }),
        });
        harness.memberRepository.query.mockResolvedValue([
            {
                memberId: '9',
                userId: '7',
                role: 'member',
                rank: '1',
                name: 'Member',
                username: 'member',
                avatars: [],
                isOnline: false,
                lastSeen: null,
            },
        ]);

        const page = await harness.service.getMembers(
            1 as never,
            2 as never,
            {},
        );

        expect(page.items[0]?.actions).toEqual({
            canPromote: false,
            canDemote: false,
            canRemove: true,
            canEditPermissions: false,
        });
        expect(page.items[0]?.avatars).toEqual([]);
        expect(page.nextCursor).toBeNull();
    });

    it('escapes LIKE wildcards in the search term', async () => {
        const harness = buildHarness({});
        harness.memberRepository.query.mockResolvedValue([]);

        await harness.service.getMembers(1 as never, 2 as never, {
            search: '  50%_  ',
        });

        const params = harness.memberRepository.query.mock.calls[0]?.[1];
        expect(params?.[2]).toBe('%50\\%\\_%');
    });

    it('rejects an invalid members cursor', async () => {
        const harness = buildHarness({});
        await expect(
            harness.service.getMembers(1 as never, 2 as never, {
                cursor: 'garbage',
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
