import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { User } from 'src/modules/auth/entities/user.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import { TypeMessage } from 'src/modules/messages/entities/typeMessage.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { DEFAULT_MEMBER_PERMISSIONS } from '../utils/member-permissions.util';
import type { ChatCallerContext } from './chat-permission.service';
import { ChatPermissionService } from './chat-permission.service';
import { GroupRealtimeService } from './group-realtime.service';
import { GroupAddMembersService } from './group-add-members.service';
import { VisibilityService } from 'src/modules/visibility/visibility.service';
import { RateLimitService } from 'src/common/services/rate-limit.service';

function callerContext(
    overrides: Partial<ChatCallerContext> = {},
): ChatCallerContext {
    return {
        chat: {
            id: 1,
            type: TypeChatEnum.GRUPE,
            isBan: false,
        } as never,
        member: { id: 10 } as ChatMember,
        memberIds: [10],
        roleName: RoleChatEnum.MANAGER,
        role: 'owner',
        permissions: [],
        isOwner: true,
        isAdmin: false,
        effectiveMemberPermissions: { ...DEFAULT_MEMBER_PERMISSIONS },
        ...overrides,
    };
}

function userRow(
    id: number,
    name: string,
    status: UserStatusEnum = UserStatusEnum.ACTIVE,
): User {
    return {
        id,
        status,
        profile: { name, username: `u${id}`, avatars: ['uploads/a.png'] },
    } as unknown as User;
}

function membershipRow(
    id: number,
    userId: number,
    roleName: RoleChatEnum,
): ChatMember {
    return {
        id,
        user: { id: userId },
        chat: { id: 1 },
        role: { id: 1, name: roleName },
    } as unknown as ChatMember;
}

interface HarnessOptions {
    caller?: ChatCallerContext;
    users?: User[];
    existingRows?: ChatMember[];
    lookupRows?: ChatMember[];
    blockedBetween?: number[];
    blockedIds?: number[];
}

function buildHarness(options: HarnessOptions = {}) {
    const caller = options.caller ?? callerContext();
    const users = options.users ?? [userRow(1, 'Sara')];
    const existingRows = options.existingRows ?? [];
    const inserted: unknown[] = [];
    const messageSaves: unknown[] = [];

    const userRepository = {
        findOne: (args: { where: { id: number } }): Promise<User | null> =>
            Promise.resolve(
                users.find((user) => user.id === args.where.id) ?? null,
            ),
    };

    const chatMemberRepository = {
        find: (): Promise<ChatMember[]> =>
            Promise.resolve(options.lookupRows ?? []),
        query: (sql: string): Promise<unknown> => {
            if (sql.includes('COUNT(DISTINCT')) {
                return Promise.resolve([{ count: String(users.length) }]);
            }
            if (sql.includes('SELECT DISTINCT')) {
                return Promise.resolve(
                    users.map((user) => ({ userId: user.id })),
                );
            }
            return Promise.resolve([]);
        },
    };

    const manager = {
        query: (sql: string, params?: unknown[]): Promise<unknown> => {
            if (sql.includes('pg_advisory_xact_lock'))
                return Promise.resolve([]);
            if (sql.includes('SELECT id, "userId"')) {
                const ids = (params?.[1] as number[] | undefined) ?? [];
                return Promise.resolve(
                    ids.map((userId, index) => ({
                        id: 100 + index,
                        userId,
                    })),
                );
            }
            if (sql.includes('FROM user_profiles')) {
                return Promise.resolve(
                    users.map((user) => ({
                        userId: user.id,
                        name: user.profile?.name ?? '',
                    })),
                );
            }
            return Promise.resolve([]);
        },
        getRepository: (entity: unknown) => {
            if (entity === User) {
                return { find: (): Promise<User[]> => Promise.resolve(users) };
            }
            if (entity === ChatMember) {
                return {
                    createQueryBuilder: () => {
                        const builder = {
                            innerJoinAndSelect: (): unknown => builder,
                            where: (): unknown => builder,
                            andWhere: (): unknown => builder,
                            getMany: (): Promise<ChatMember[]> =>
                                Promise.resolve(existingRows),
                        };
                        return builder;
                    },
                    insert: (rows: unknown): Promise<void> => {
                        inserted.push(rows);
                        return Promise.resolve();
                    },
                };
            }
            if (entity === RoleChat) {
                return {
                    findOne: (): Promise<unknown> =>
                        Promise.resolve({
                            id: 1,
                            name: RoleChatEnum.USER,
                        }),
                };
            }
            if (entity === TypeMessage) {
                return {
                    findOneOrFail: (): Promise<unknown> =>
                        Promise.resolve({ id: 9, name: 'system' }),
                };
            }
            if (entity === Message) {
                return {
                    save: (data: Record<string, unknown>): Promise<unknown> => {
                        messageSaves.push(data);
                        return Promise.resolve({
                            ...data,
                            id: messageSaves.length,
                        });
                    },
                };
            }
            throw new Error('unexpected repository');
        },
    };

    const permissions = {
        getCallerContext: jest.fn().mockResolvedValue(caller),
        assertGroup: jest.fn(),
    };
    const realtime = {
        groupChanged: jest.fn(),
        groupAdded: jest.fn(),
        broadcastServiceMessage: jest.fn(),
        membersCountChanged: jest.fn(),
    };
    const visibility = {
        isBlockedBetween: jest.fn().mockResolvedValue(false),
        blockedIdsBetween: jest
            .fn()
            .mockResolvedValue(new Set(options.blockedIds ?? [])),
    };
    const rateLimit = { consume: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
        transaction: <T>(run: (m: unknown) => Promise<T>): Promise<T> =>
            run(manager),
    };

    const service = new GroupAddMembersService(
        chatMemberRepository as never,
        userRepository as never,
        {} as never,
        dataSource as never,
        permissions as unknown as ChatPermissionService,
        realtime as unknown as GroupRealtimeService,
        rateLimit as unknown as RateLimitService,
        visibility as unknown as VisibilityService,
    );

    return {
        service,
        permissions,
        realtime,
        visibility,
        rateLimit,
        inserted,
        messageSaves,
    };
}

describe('GroupAddMembersService', () => {
    describe('lookupUser', () => {
        it('rejects an invalid id with 400', async () => {
            const { service } = buildHarness();
            await expect(
                service.lookupUser(1 as never, 2 as never, 'abc'),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('returns only the public projection plus membership state', async () => {
            const { service } = buildHarness({
                lookupRows: [membershipRow(5, 7, RoleChatEnum.USER)],
                users: [userRow(7, 'Ali')],
            });
            const result = await service.lookupUser(1 as never, 2 as never, 7);
            expect(result).toEqual({
                userId: 7,
                name: 'Ali',
                username: 'u7',
                avatars: ['uploads/a.png'],
                isMember: true,
                isBanned: false,
            });
            expect(result).not.toHaveProperty('phone');
        });

        it('flags a banned membership row', async () => {
            const { service } = buildHarness({
                lookupRows: [membershipRow(5, 7, RoleChatEnum.BAN)],
                users: [userRow(7, 'Ali')],
            });
            const result = await service.lookupUser(1 as never, 2 as never, 7);
            expect(result.isMember).toBe(false);
            expect(result.isBanned).toBe(true);
        });

        it('answers the same generic 404 for a blocked pair', async () => {
            const { service, visibility } = buildHarness();
            visibility.isBlockedBetween.mockResolvedValue(true);
            await expect(
                service.lookupUser(1 as never, 2 as never, 7),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('rejects a caller without the add-members capability', async () => {
            const { service } = buildHarness({
                caller: callerContext({
                    isOwner: false,
                    isAdmin: false,
                    role: 'member',
                    roleName: RoleChatEnum.USER,
                    effectiveMemberPermissions: {
                        ...DEFAULT_MEMBER_PERMISSIONS,
                        add_members: false,
                    },
                }),
            });
            await expect(
                service.lookupUser(1 as never, 2 as never, 7),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('addMembers', () => {
        it('adds valid users and reports per-user failures (partial success)', async () => {
            const { service, inserted, realtime } = buildHarness({
                users: [
                    userRow(1, 'Sara'),
                    userRow(2, 'Ali'),
                    userRow(4, 'Banned'),
                ],
                existingRows: [
                    membershipRow(20, 2, RoleChatEnum.USER),
                    membershipRow(21, 4, RoleChatEnum.BAN),
                ],
            });
            const result = await service.addMembers(
                1 as never,
                2 as never,
                [1, 2, 3, 4],
            );

            expect(result.added).toEqual([
                expect.objectContaining({ userId: 1, role: 'member' }),
            ]);
            expect(result.failed.map((failure) => failure.code)).toEqual([
                'already_member',
                'not_found',
                'banned',
            ]);
            expect(inserted).toHaveLength(1);
            expect(realtime.groupAdded).toHaveBeenCalledWith(1, 1);
            expect(realtime.groupChanged).toHaveBeenCalledWith(
                1,
                'member_joined',
            );
            expect(realtime.membersCountChanged).toHaveBeenCalled();
        });

        it('is a no-op batch when every user is rejected', async () => {
            const { service, inserted, realtime } = buildHarness({
                users: [userRow(1, 'Sara')],
                existingRows: [membershipRow(20, 1, RoleChatEnum.USER)],
            });
            const result = await service.addMembers(
                1 as never,
                2 as never,
                [1],
            );
            expect(result.added).toEqual([]);
            expect(inserted).toHaveLength(0);
            expect(realtime.groupAdded).not.toHaveBeenCalled();
        });

        it('rejects blocked users without leaking the reason', async () => {
            const { service } = buildHarness({ blockedIds: [1] });
            const result = await service.addMembers(
                1 as never,
                2 as never,
                [1],
            );
            expect(result.added).toEqual([]);
            expect(result.failed[0]?.code).toBe('blocked');
        });

        it('rejects an empty, oversized or malformed batch', async () => {
            const { service } = buildHarness();
            for (const payload of [
                [],
                ['x'],
                Array.from({ length: 51 }, (_, index) => index + 1),
            ]) {
                await expect(
                    service.addMembers(1 as never, 2 as never, payload),
                ).rejects.toBeInstanceOf(BadRequestException);
            }
        });

        it('deduplicates ids before writing', async () => {
            const { service, inserted } = buildHarness();
            const result = await service.addMembers(
                1 as never,
                2 as never,
                [1, 1, 1],
            );
            expect(result.added).toHaveLength(1);
            expect(inserted).toHaveLength(1);
        });

        it('honors a regular member with add_members enabled', async () => {
            const { service } = buildHarness({
                caller: callerContext({
                    isOwner: false,
                    isAdmin: false,
                    role: 'member',
                    roleName: RoleChatEnum.USER,
                    permissions: [],
                    effectiveMemberPermissions: {
                        ...DEFAULT_MEMBER_PERMISSIONS,
                        add_members: true,
                    },
                }),
            });
            const result = await service.addMembers(
                1 as never,
                2 as never,
                [1],
            );
            expect(result.added).toHaveLength(1);
        });

        it('honors a deny override for a regular member', async () => {
            const { service } = buildHarness({
                caller: callerContext({
                    isOwner: false,
                    isAdmin: false,
                    role: 'member',
                    roleName: RoleChatEnum.USER,
                    effectiveMemberPermissions: {
                        ...DEFAULT_MEMBER_PERMISSIONS,
                        add_members: false,
                    },
                }),
            });
            await expect(
                service.addMembers(1 as never, 2 as never, [1]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('requires manage_members for an admin', async () => {
            const base = callerContext({
                isOwner: false,
                isAdmin: true,
                role: 'admin',
                roleName: RoleChatEnum.ADMIN,
            });
            const denied = buildHarness({
                caller: { ...base, permissions: [] },
            });
            await expect(
                denied.service.addMembers(1 as never, 2 as never, [1]),
            ).rejects.toBeInstanceOf(ForbiddenException);

            const allowed = buildHarness({
                caller: {
                    ...base,
                    permissions: ['manage_members'] as never,
                },
            });
            const result = await allowed.service.addMembers(
                1 as never,
                2 as never,
                [1],
            );
            expect(result.added).toHaveLength(1);
        });

        it('lets the owner add without an explicit grant', async () => {
            const { service } = buildHarness({
                caller: callerContext({ isOwner: true, permissions: [] }),
            });
            const result = await service.addMembers(
                1 as never,
                2 as never,
                [1],
            );
            expect(result.added).toHaveLength(1);
        });

        it('re-checks the capability inside the transaction lock', async () => {
            const { service } = buildHarness({
                caller: callerContext({
                    isOwner: false,
                    isAdmin: false,
                    role: 'member',
                    roleName: RoleChatEnum.USER,
                    effectiveMemberPermissions: {
                        ...DEFAULT_MEMBER_PERMISSIONS,
                        add_members: true,
                    },
                }),
            });
            // Simulates a concurrent policy/override change between the
            // pre-check and the lock: the service asks again inside the tx.
            (
                service as unknown as {
                    permissions: { getCallerContext: jest.Mock };
                }
            ).permissions.getCallerContext
                .mockResolvedValueOnce(
                    callerContext({
                        isOwner: false,
                        isAdmin: false,
                        role: 'member',
                        roleName: RoleChatEnum.USER,
                        effectiveMemberPermissions: {
                            ...DEFAULT_MEMBER_PERMISSIONS,
                            add_members: true,
                        },
                    }),
                )
                .mockResolvedValueOnce(
                    callerContext({
                        isOwner: false,
                        isAdmin: false,
                        role: 'member',
                        roleName: RoleChatEnum.USER,
                        effectiveMemberPermissions: {
                            ...DEFAULT_MEMBER_PERMISSIONS,
                            add_members: false,
                        },
                    }),
                );

            await expect(
                service.addMembers(1 as never, 2 as never, [1]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });
});
