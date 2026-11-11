import {
    ConflictException,
    ForbiddenException,
    HttpException,
    NotFoundException,
} from '@nestjs/common';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { Link } from '../entities/link.entity';
import { RoleChat } from '../entities/role_chat.entity';
import type { ChatCallerContext } from './chat-permission.service';
import { GroupInviteLinksService } from './group-invite-links.service';
import {
    computeInviteStatus,
    generateInviteCode,
} from '../utils/invite-link.util';

interface MemberRow {
    chatId: number;
    userId: number;
    role: RoleChatEnum;
}

interface Store {
    chat: Chat;
    links: Link[];
    members: MemberRow[];
    nextId: number;
}

function makeHarness(
    role: 'manager' | 'admin' | 'user' = 'manager',
    seedCaller = true,
) {
    const chat = {
        id: 1,
        type: TypeChatEnum.GRUPE,
        isBan: false,
        title: 'Team',
        description: 'A group',
        avatars: ['uploads/group.jpg'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as unknown as Chat;

    const store: Store = {
        chat,
        links: [],
        members: [],
        nextId: 1,
    };
    let insertFailures = 0;
    if (seedCaller) {
        store.members.push({
            chatId: 1,
            userId: role === 'manager' ? 1 : role === 'admin' ? 2 : 7,
            role:
                role === 'manager'
                    ? RoleChatEnum.MANAGER
                    : role === 'admin'
                      ? RoleChatEnum.ADMIN
                      : RoleChatEnum.USER,
        });
    }

    const makeLink = (overrides: Partial<Link> = {}): Link => {
        const base = {
            id: store.nextId++,
            code: generateInviteCode(),
            chatId: Number(chat.id),
            createdByUserId: '1',
            usageLimit: 0,
            usageCount: 0,
            maxUses: null,
            usesCount: 0,
            expiresAt: null,
            revokedAt: null,
            isActive: true,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        return { ...base, ...overrides } as unknown as Link;
    };

    const activeAt = (link: Link, now: Date): boolean =>
        computeInviteStatus(link, now) === 'active';

    const linkQueryBuilder = () => {
        const params: Record<string, unknown> = {};
        let firstWhere = '';
        let inactive = false;
        const qb = {
            innerJoinAndSelect: () => qb,
            where: (sql: string, values?: Record<string, unknown>) => {
                firstWhere = sql;
                Object.assign(params, values ?? {});
                return qb;
            },
            andWhere: (sql: string, values?: Record<string, unknown>) => {
                Object.assign(params, values ?? {});
                if (sql.includes('"isActive" = false')) inactive = true;
                return qb;
            },
            orderBy: () => qb,
            addOrderBy: () => qb,
            limit: () => qb,
            setLock: () => qb,
            getOne: async (): Promise<Link | null> => {
                if (params.code !== undefined) {
                    const link = store.links.find(
                        (item) => item.code === params.code,
                    );
                    return link === undefined
                        ? null
                        : ({ ...link, chat: store.chat } as unknown as Link);
                }
                if (params.linkId !== undefined) {
                    return (
                        store.links.find(
                            (link) =>
                                Number(link.id) === Number(params.linkId) &&
                                Number(link.chatId) ===
                                    Number(params.chatId),
                        ) ?? null
                    );
                }
                return null;
            },
            getMany: async (): Promise<Link[]> => {
                if (!firstWhere.includes('l."chatId"')) return [];
                const now = (params.now as Date | undefined) ?? new Date();
                return store.links.filter(
                    (link) =>
                        Number(link.chatId) === Number(params.chatId) &&
                        activeAt(link, now) !== inactive,
                );
            },
        };
        return qb;
    };

    const memberQueryBuilder = () => {
        let chatId: number | undefined;
        let userId: number | undefined;
        const qb = {
            innerJoinAndSelect: () => qb,
            where: (_sql: string, values?: { chatId?: number }) => {
                chatId = values?.chatId;
                return qb;
            },
            andWhere: (_sql: string, values?: { userId?: number }) => {
                userId = values?.userId;
                return qb;
            },
            setLock: () => qb,
            getMany: async (): Promise<ChatMember[]> =>
                store.members
                    .filter(
                        (row) =>
                            Number(row.chatId) === Number(chatId) &&
                            Number(row.userId) === Number(userId),
                    )
                    .map(
                        (row, index) =>
                            ({
                                id: index + 1,
                                chat: { id: row.chatId },
                                user: { id: row.userId },
                                role: { name: row.role },
                            }) as unknown as ChatMember,
                    ),
        };
        return qb;
    };

    const linkRepository = {
        createQueryBuilder: linkQueryBuilder,
        findOne: async (options: {
            where: { code?: string };
        }): Promise<Link | null> => {
            const link = store.links.find(
                (item) => item.code === options.where.code,
            );
            return link === undefined
                ? null
                : ({ ...link, chat: store.chat } as unknown as Link);
        },
        save: async (value: Partial<Link> & { chat?: { id: number } }) => {
            if (insertFailures > 0) {
                insertFailures -= 1;
                const error = new Error('duplicate key') as Error & {
                    driverError: { code: string };
                };
                error.driverError = { code: '23505' };
                throw error;
            }
            const existing =
                value.id === undefined
                    ? undefined
                    : store.links.find(
                          (link) => Number(link.id) === Number(value.id),
                      );
            if (existing !== undefined) {
                Object.assign(existing, value);
                return existing;
            }
            const created = makeLink({
                ...value,
                chatId: Number(value.chat?.id ?? value.chatId ?? chat.id),
            } as Partial<Link>);
            store.links.push(created);
            return created;
        },
    };

    const memberRepository = {
        createQueryBuilder: memberQueryBuilder,
        find: async (options: {
            where: { chat: { id: number }; user: { id: number } };
        }): Promise<ChatMember[]> =>
            store.members
                .filter(
                    (row) =>
                        Number(row.chatId) ===
                            Number(options.where.chat.id) &&
                        Number(row.userId) ===
                            Number(options.where.user.id),
                )
                .map(
                    (row, index) =>
                        ({
                            id: index + 1,
                            chat: { id: row.chatId },
                            user: { id: row.userId },
                            role: { name: row.role },
                        }) as unknown as ChatMember,
                ),
        insert: async (value: {
            chat: { id: number };
            user: { id: number };
            role: { id: number };
        }): Promise<void> => {
            store.members.push({
                chatId: Number(value.chat.id),
                userId: Number(value.user.id),
                role: RoleChatEnum.USER,
            });
        },
        query: async (
            sql: string,
            params: unknown[],
        ): Promise<Array<{ count: string | number }>> => {
            if (sql.includes('COUNT(DISTINCT m."userId")')) {
                const chatId = Number(params[0]);
                const users = new Set(
                    store.members
                        .filter(
                            (row) =>
                                Number(row.chatId) === chatId &&
                                row.role !== RoleChatEnum.BAN,
                        )
                        .map((row) => row.userId),
                );
                return [{ count: users.size }];
            }
            return [];
        },
    };

    const chatRepository = {
        findOne: async (options: {
            where: { id: number };
        }): Promise<Chat | null> =>
            Number(store.chat.id) === Number(options.where.id)
                ? store.chat
                : null,
    };

    const roleRepository = {
        findOne: async (): Promise<RoleChat> =>
            ({ id: 1, name: RoleChatEnum.USER }) as unknown as RoleChat,
    };

    const profileRepository = {
        query: async (): Promise<Array<{ userId: number; name: string }>> => [],
    };

    interface FakeManager {
        getRepository: (entity: unknown) => unknown;
        query: (
            sql: string,
            params: unknown[],
        ) => Promise<Array<{ count: string | number }>>;
    }

    const manager: FakeManager = {
        getRepository: (entity: unknown): unknown => {
            if (entity === Link) return linkRepository;
            if (entity === ChatMember) return memberRepository;
            if (entity === Chat) return chatRepository;
            if (entity === RoleChat) return roleRepository;
            return {};
        },
        query: async (
            sql: string,
            params: unknown[],
        ): Promise<Array<{ count: string | number }>> => {
            if (
                sql.includes('SELECT COUNT(*)::int AS count') &&
                sql.includes('FROM "link"')
            ) {
                const chatId = Number(params[0]);
                return [
                    {
                        count: store.links.filter(
                            (link) =>
                                Number(link.chatId) === chatId &&
                                activeAt(link, new Date()),
                        ).length,
                    },
                ];
            }
            if (sql.includes('WITH updated AS')) {
                const link = store.links.find(
                    (item) => Number(item.id) === Number(params[0]),
                );
                if (
                    link === undefined ||
                    computeInviteStatus(link, new Date()) !== 'active'
                ) {
                    return [{ count: 0 }];
                }
                link.usesCount += 1;
                link.usageCount += 1;
                return [{ count: 1 }];
            }
            return [];
        },
    };

    // Serialise transactions the way the chat-row/link-row FOR UPDATE locks do.
    let chain: Promise<unknown> = Promise.resolve();
    const dataSource = {
        transaction: async <T>(
            callback: (manager: FakeManager) => Promise<T>,
        ): Promise<T> => {
            const run = chain.then(async (): Promise<T> => {
                const links = store.links.map((link) => ({ ...link }));
                const members = store.members.map((row) => ({ ...row }));
                try {
                    return await callback(manager);
                } catch (error) {
                    store.links = links;
                    store.members = members;
                    throw error;
                }
            });
            chain = run.then(
                () => undefined,
                () => undefined,
            );
            return run;
        },
    };

    const isOwner = role === 'manager';
    const isAdmin = role === 'admin';
    const caller = {
        chat,
        member: {} as ChatMember,
        memberIds: [],
        roleName: isOwner
            ? RoleChatEnum.MANAGER
            : isAdmin
              ? RoleChatEnum.ADMIN
              : RoleChatEnum.USER,
        role: isOwner ? 'owner' : isAdmin ? 'admin' : 'member',
        permissions: [],
        isOwner,
        isAdmin,
    } as unknown as ChatCallerContext;

    const permissions = {
        getCallerContext: jest.fn(async () => caller),
        assertGroup: jest.fn(),
    };
    const realtime = {
        groupChanged: jest.fn(),
        groupAdded: jest.fn(),
        membersCountChanged: jest.fn(),
    };
    const rateLimit = {
        consume: jest.fn(async () => 1),
    };

    const service = new GroupInviteLinksService(
        linkRepository as never,
        memberRepository as never,
        profileRepository as never,
        dataSource as never,
        permissions as never,
        realtime as never,
        rateLimit as never,
    );

    return {
        service,
        store,
        chat,
        makeLink,
        permissions,
        realtime,
        rateLimit,
        failInserts: (times: number): void => {
            insertFailures = times;
        },
    };
}

async function expectStatus(
    promise: Promise<unknown>,
    status: number,
    message?: string,
): Promise<void> {
    try {
        await promise;
        throw new Error('Expected the call to reject');
    } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const http = error as HttpException;
        expect(http.getStatus()).toBe(status);
        if (message !== undefined) {
            expect(http.message).toBe(message);
        }
    }
}

describe('GroupInviteLinksService management', () => {
    it('creates a 22-character active link for the owner', async () => {
        const { service, store } = makeHarness('manager');
        const item = await service.createLink(1 as never, 1 as never, {
            expiresInSeconds: null,
            maxUses: null,
        });
        expect(item.code).toHaveLength(22);
        expect(item.status).toBe('active');
        expect(item.usesCount).toBe(0);
        expect(store.links).toHaveLength(1);
    });

    it('regenerates the code after a unique collision and then succeeds', async () => {
        const harness = makeHarness('manager');
        harness.failInserts(1);
        const item = await harness.service.createLink(
            1 as never,
            1 as never,
            {},
        );
        expect(item.code).toHaveLength(22);
        expect(harness.store.links).toHaveLength(1);
        expect(harness.realtime.groupChanged).toHaveBeenCalledTimes(1);
    });

    it('lets an admin manage links', async () => {
        const { service } = makeHarness('admin');
        await expect(
            service.createLink(1 as never, 2 as never, {}),
        ).resolves.toMatchObject({ status: 'active' });
        await expect(
            service.listLinks(1 as never, 2 as never),
        ).resolves.toMatchObject({ activeCount: 1, maxActive: 10 });
    });

    it('rejects a member for create, list and revoke', async () => {
        const { service, makeLink, store } = makeHarness('user');
        const link = makeLink();
        store.links.push(link);
        await expectStatus(
            service.listLinks(1 as never, 7 as never),
            403,
        );
        await expectStatus(
            service.createLink(1 as never, 7 as never, {}),
            403,
        );
        await expectStatus(
            service.revokeLink(1 as never, Number(link.id), 7 as never),
            403,
        );
    });

    it('returns active links plus inactive ones with computed statuses', async () => {
        const { service, store, makeLink } = makeHarness('manager');
        const now = Date.now();
        store.links.push(
            makeLink(),
            makeLink({
                expiresAt: new Date(now - 60_000),
                isActive: true,
            }),
            makeLink({ maxUses: 1, usesCount: 1 }),
            makeLink({ revokedAt: new Date(), isActive: false }),
        );
        const page = await service.listLinks(1 as never, 1 as never);
        expect(page.activeCount).toBe(1);
        expect(page.maxActive).toBe(10);
        expect(page.items.map((item) => item.status).sort()).toEqual([
            'active',
            'expired',
            'revoked',
            'used_up',
        ]);
    });

    it('caps concurrent creation at ten active links', async () => {
        const { service, store } = makeHarness('manager');
        const results = await Promise.allSettled(
            Array.from({ length: 12 }, () =>
                service.createLink(1 as never, 1 as never, {}),
            ),
        );
        const fulfilled = results.filter(
            (result) => result.status === 'fulfilled',
        );
        const rejected = results.filter(
            (result) => result.status === 'rejected',
        );
        expect(fulfilled).toHaveLength(10);
        expect(rejected).toHaveLength(2);
        for (const result of rejected) {
            expect(
                (result as PromiseRejectedResult).reason,
            ).toBeInstanceOf(ConflictException);
        }
        expect(store.links.filter((link) => link.isActive)).toHaveLength(10);
    });

    it('answers 404 when revoking a link of another chat', async () => {
        const { service, makeLink, store } = makeHarness('manager');
        const foreign = makeLink({ chatId: 2 as never });
        store.links.push(foreign);

        await expectStatus(
            service.revokeLink(1 as never, Number(foreign.id), 1 as never),
            404,
        );
        expect(foreign.isActive).toBe(true);
    });

    it('revokes idempotently and keeps the legacy active flag consistent', async () => {
        const { service, makeLink, store, realtime } =
            makeHarness('manager');
        const link = makeLink();
        store.links.push(link);

        await expect(
            service.revokeLink(1 as never, Number(link.id), 1 as never),
        ).resolves.toEqual({
            id: Number(link.id),
            status: 'revoked',
            changed: true,
        });
        expect(link.isActive).toBe(false);
        expect(link.revokedAt).not.toBeNull();
        expect(realtime.groupChanged).toHaveBeenCalledWith(
            1,
            'invite_links_changed',
            1,
        );

        await expect(
            service.revokeLink(1 as never, Number(link.id), 1 as never),
        ).resolves.toEqual({
            id: Number(link.id),
            status: 'revoked',
            changed: false,
        });
    });
});

describe('GroupInviteLinksService join side', () => {
    it('previews a valid link and reports membership', async () => {
        const { service, makeLink, store } = makeHarness('manager', false);
        const link = makeLink();
        store.links.push(link);

        await expect(
            service.preview(link.code, 99 as never),
        ).resolves.toEqual({
            title: 'Team',
            description: 'A group',
            avatar: 'uploads/group.jpg',
            membersCount: 0,
            alreadyMember: false,
            chatId: null,
        });

        store.members.push({
            chatId: 1,
            userId: 99,
            role: RoleChatEnum.USER,
        });
        await expect(
            service.preview(link.code, 99 as never),
        ).resolves.toMatchObject({ alreadyMember: true, chatId: 1 });
    });

    it('joins a valid link with role user, one use and realtime events', async () => {
        const { service, makeLink, store, realtime } = makeHarness('manager', false);
        const link = makeLink();
        store.links.push(link);

        await expect(
            service.joinByCode(link.code, 99 as never),
        ).resolves.toEqual({
            chatId: 1,
            title: 'Team',
            joined: true,
            alreadyMember: false,
        });
        expect(store.members).toEqual([
            { chatId: 1, userId: 99, role: RoleChatEnum.USER },
        ]);
        expect(link.usesCount).toBe(1);
        expect(realtime.groupChanged).toHaveBeenCalledWith(
            1,
            'member_joined',
            99,
        );
        expect(realtime.groupAdded).toHaveBeenCalledWith(1, 99);
    });

    it('does not duplicate an existing member or consume a use', async () => {
        const { service, makeLink, store } = makeHarness('manager', false);
        const link = makeLink();
        store.links.push(link);
        store.members.push(
            { chatId: 1, userId: 99, role: RoleChatEnum.USER },
            { chatId: 1, userId: 99, role: RoleChatEnum.USER },
        );

        await expect(
            service.joinByCode(link.code, 99 as never),
        ).resolves.toMatchObject({
            alreadyMember: true,
            joined: false,
        });
        expect(store.members).toHaveLength(2);
        expect(link.usesCount).toBe(0);
    });

    it('rejects a banned member with 403, even with a valid link', async () => {
        const { service, makeLink, store } = makeHarness('manager', false);
        const link = makeLink();
        store.links.push(link);
        store.members.push({
            chatId: 1,
            userId: 99,
            role: RoleChatEnum.BAN,
        });

        await expectStatus(
            service.joinByCode(link.code, 99 as never),
            403,
            "You can't join this group",
        );
        await expectStatus(
            service.preview(link.code, 99 as never),
            403,
            "You can't join this group",
        );
        expect(link.usesCount).toBe(0);
    });

    it('answers the same 404 for every invalid link state', async () => {
        const { service, makeLink, store } = makeHarness('manager', false);
        const usable = makeLink();
        store.links.push(usable);
        const message = 'This invite link is invalid or has expired';

        const malformed = 'deadbeef'.repeat(4);
        await expectStatus(service.joinByCode(malformed, 99 as never), 404, message);
        await expectStatus(service.preview(malformed, 99 as never), 404, message);

        await expectStatus(
            service.joinByCode('A'.repeat(22), 99 as never),
            404,
            message,
        );

        for (const patch of [
            { revokedAt: new Date(), isActive: false },
            { expiresAt: new Date(Date.now() - 1000) },
            { maxUses: 1, usesCount: 1 },
        ]) {
            store.links = [makeLink(patch)];
            await expectStatus(
                service.joinByCode(store.links[0]!.code, 99 as never),
                404,
                message,
            );
            await expectStatus(
                service.preview(store.links[0]!.code, 99 as never),
                404,
                message,
            );
        }

        store.links = [makeLink()];
        store.chat = {
            ...store.chat,
            type: TypeChatEnum.PRIVATE,
        } as Chat;
        await expectStatus(
            service.joinByCode(store.links[0]!.code, 99 as never),
            404,
            message,
        );

        store.chat = { ...store.chat, type: TypeChatEnum.GRUPE, isBan: true } as Chat;
        await expectStatus(
            service.joinByCode(store.links[0]!.code, 99 as never),
            404,
            message,
        );
    });

    it('admits exactly maxUses of concurrent joiners', async () => {
        const { service, makeLink, store } = makeHarness('manager', false);
        const link = makeLink({ maxUses: 3 });
        store.links.push(link);

        const results = await Promise.allSettled(
            Array.from({ length: 10 }, (_, index) =>
                service.joinByCode(link.code, (100 + index) as never),
            ),
        );
        const fulfilled = results.filter(
            (result) => result.status === 'fulfilled',
        );
        expect(fulfilled).toHaveLength(3);
        expect(store.members).toHaveLength(3);
        expect(store.links[0]?.usesCount).toBe(3);
        for (const result of results) {
            if (result.status === 'rejected') {
                expect(result.reason).toBeInstanceOf(NotFoundException);
            }
        }
    });

    it('propagates the join/preview rate limit', async () => {
        const { service, makeLink, store, rateLimit } = makeHarness('manager', false);
        const link = makeLink();
        store.links.push(link);
        rateLimit.consume.mockRejectedValueOnce(
            new HttpException('Too many join attempts', 429),
        );
        await expectStatus(
            service.joinByCode(link.code, 99 as never),
            429,
        );
    });
});
