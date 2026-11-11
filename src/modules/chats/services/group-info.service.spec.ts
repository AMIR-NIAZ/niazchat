import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Chat } from '../entities/chat.entity';
import { ChatPermissionService } from './chat-permission.service';
import type { ChatCallerContext } from './chat-permission.service';
import {
    GROUP_AVATAR_LIMIT_MESSAGE,
    GroupInfoService,
    MAX_GROUP_AVATARS,
} from './group-info.service';

interface FakeChat {
    id: number;
    type: TypeChatEnum;
    isBan: boolean;
    title?: string;
    description?: string | null;
    avatars: string[];
}

function callerContext(
    overrides: Partial<ChatCallerContext> = {},
): ChatCallerContext {
    return {
        chat: {
            id: 1,
            type: TypeChatEnum.GRUPE,
            isBan: false,
            title: 'Old',
            description: null,
            avatars: [],
        } as never,
        member: { id: 100 } as never,
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
    chat?: FakeChat;
    rateConsume?: jest.Mock;
    transactionError?: Error;
    memberIds?: number[];
}) {
    const chatState: FakeChat = options.chat ?? {
        id: 1,
        type: TypeChatEnum.GRUPE,
        isBan: false,
        title: 'Old',
        description: null,
        avatars: [],
    };
    const updates: Array<Record<string, unknown>> = [];

    const chatRepositoryForManager = {
        createQueryBuilder: (): unknown => {
            const builder = {
                where: (): unknown => builder,
                setLock: (): unknown => builder,
                getOne: (): Promise<FakeChat> => Promise.resolve(chatState),
            };
            return builder;
        },
        update: (id: number, patch: Record<string, unknown>): Promise<void> => {
            updates.push(patch);
            Object.assign(chatState, patch);
            void id;
            return Promise.resolve();
        },
    };

    const manager = {
        getRepository: (entity: unknown): unknown => {
            if (entity === Chat) return chatRepositoryForManager;
            throw new Error('unexpected repository');
        },
    };

    const dataSource = {
        transaction: <T>(run: (manager: unknown) => Promise<T>): Promise<T> =>
            options.transactionError !== undefined
                ? Promise.reject(options.transactionError)
                : run(manager),
    };

    const memberRepository = {
        query: jest.fn(
            (): Promise<Array<{ userId: string | number }>> =>
                Promise.resolve(
                    (options.memberIds ?? [2, 7]).map((userId) => ({
                        userId,
                    })),
                ),
        ),
    };

    const permissionService = new ChatPermissionService(
        {} as never,
        {} as never,
    );
    const caller = options.caller ?? callerContext();
    jest.spyOn(permissionService, 'getCallerContext').mockResolvedValue(caller);

    const realtime = {
        groupInfoChanged: jest.fn(),
        groupAvatarsChanged: jest.fn(),
        groupUpdated: jest.fn(),
    };
    const rateLimit = {
        consume:
            options.rateConsume ??
            jest.fn((): Promise<number> => Promise.resolve(1)),
    };

    const chatRepository = {
        findOne: jest.fn(
            (): Promise<{ id: number; avatars: string[] }> =>
                Promise.resolve({
                    id: chatState.id,
                    avatars: [...chatState.avatars],
                }),
        ),
    };

    const service = new GroupInfoService(
        chatRepository as never,
        memberRepository as never,
        dataSource as never,
        permissionService,
        realtime as never,
        rateLimit as never,
    );

    return {
        service,
        chatState,
        caller,
        memberRepository,
        permissionService,
        realtime,
        rateLimit,
        updates,
        chatRepository,
    };
}

const flush = (): Promise<void> =>
    new Promise((resolve): void => {
        setImmediate(resolve);
    });

const adminCaller = (permissions: PermissionChatEnum[]): ChatCallerContext =>
    callerContext({
        roleName: RoleChatEnum.ADMIN,
        role: 'admin',
        isOwner: false,
        isAdmin: true,
        permissions,
    });

describe('GroupInfoService text edits', () => {
    it('saves title and description and emits info_changed + group:updated', async () => {
        const harness = buildHarness({});
        const result = await harness.service.updateGroupInfo(
            1 as never,
            2 as never,
            { title: 'New', description: 'Hello' },
        );

        expect(result).toEqual({
            id: 1,
            title: 'New',
            description: 'Hello',
            avatars: [],
            changed: true,
        });
        expect(harness.chatState.title).toBe('New');
        expect(harness.chatState.description).toBe('Hello');
        expect(harness.updates).toHaveLength(1);

        await flush();
        expect(harness.realtime.groupInfoChanged).toHaveBeenCalledWith(1, 2);
        expect(harness.realtime.groupUpdated).toHaveBeenCalledWith(
            1,
            'New',
            [],
            [2, 7],
        );
    });

    it('is idempotent: identical values answer changed:false and emit nothing', async () => {
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Same',
                description: 'Same description',
                avatars: [],
            },
        });
        const result = await harness.service.updateGroupInfo(
            1 as never,
            2 as never,
            { title: '  Same  ', description: ' Same description ' },
        );

        expect(result.changed).toBe(false);
        expect(harness.updates).toHaveLength(0);
        await flush();
        expect(harness.realtime.groupInfoChanged).not.toHaveBeenCalled();
        expect(harness.realtime.groupUpdated).not.toHaveBeenCalled();
    });

    it('clears the description with null', async () => {
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                description: 'Old description',
                avatars: [],
            },
        });
        const result = await harness.service.updateGroupInfo(
            1 as never,
            2 as never,
            { description: null },
        );
        expect(result.description).toBeNull();
        expect(harness.chatState.description).toBeNull();
    });

    it('rejects a body with no fields', async () => {
        const harness = buildHarness({});
        await expect(
            harness.service.updateGroupInfo(1 as never, 2 as never, {}),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(harness.updates).toHaveLength(0);
    });

    it('lets an admin with change_info_chat edit', async () => {
        const harness = buildHarness({
            caller: adminCaller([PermissionChatEnum.CHANGE_INFO_CHAT]),
        });
        const result = await harness.service.updateGroupInfo(
            1 as never,
            9 as never,
            { title: 'Admin title' },
        );
        expect(result.changed).toBe(true);
    });

    it('lets an admin with the legacy all grant edit', async () => {
        const harness = buildHarness({
            caller: adminCaller([PermissionChatEnum.ALL]),
        });
        const result = await harness.service.updateGroupInfo(
            1 as never,
            9 as never,
            { title: 'All title' },
        );
        expect(result.changed).toBe(true);
    });

    it('refuses an admin without the permission, a member and an outsider', async () => {
        const withoutPermission = buildHarness({
            caller: adminCaller([PermissionChatEnum.BAN_USER]),
        });
        await expect(
            withoutPermission.service.updateGroupInfo(1 as never, 9 as never, {
                title: 'Nope',
            }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const member = buildHarness({
            caller: callerContext({
                roleName: RoleChatEnum.USER,
                role: 'member',
                isOwner: false,
                isAdmin: false,
            }),
        });
        await expect(
            member.service.updateGroupInfo(1 as never, 9 as never, {
                title: 'Nope',
            }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        // Outsiders/banned callers are rejected by getCallerContext.
        const outsider = buildHarness({});
        jest.spyOn(
            outsider.permissionService,
            'getCallerContext',
        ).mockRejectedValueOnce(new ForbiddenException('not a member'));
        await expect(
            outsider.service.updateGroupInfo(1 as never, 9 as never, {
                title: 'Nope',
            }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 400 for a private chat and 403 for a banned chat', async () => {
        const privateChat = buildHarness({
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
            privateChat.service.updateGroupInfo(1 as never, 2 as never, {
                title: 'Nope',
            }),
        ).rejects.toBeInstanceOf(BadRequestException);

        const banned = buildHarness({
            caller: callerContext({
                chat: {
                    id: 1,
                    type: TypeChatEnum.GRUPE,
                    isBan: true,
                    avatars: [],
                } as never,
            }),
        });
        await expect(
            banned.service.updateGroupInfo(1 as never, 2 as never, {
                title: 'Nope',
            }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('enforces the per-user rate limit before the transaction', async () => {
        const consume = jest.fn((): Promise<number> => {
            throw new HttpException('Too many group info changes', 429);
        });
        const harness = buildHarness({ rateConsume: consume });
        await expect(
            harness.service.updateGroupInfo(1 as never, 2 as never, {
                title: 'Nope',
            }),
        ).rejects.toMatchObject({ status: 429 });
        expect(harness.updates).toHaveLength(0);
    });
});

describe('GroupInfoService avatars', () => {
    let root: string;
    let previousCwd: string;

    beforeAll(async () => {
        previousCwd = process.cwd();
        root = await fs.promises.mkdtemp(join(os.tmpdir(), 'niazchat-info-'));
        process.chdir(root);
        await fs.promises.mkdir(join(root, 'uploads', 'avatars'), {
            recursive: true,
        });
    });

    afterAll(async () => {
        process.chdir(previousCwd);
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    async function writePng(name: string): Promise<string> {
        const path = join(root, 'uploads', 'avatars', name);
        await sharp({
            create: {
                width: 2,
                height: 2,
                channels: 3,
                background: { r: 255, g: 0, b: 0 },
            },
        })
            .png()
            .toFile(path);
        return path;
    }

    function uploadFile(path: string): Express.Multer.File {
        return {
            path,
            mimetype: 'image/png',
            size: fs.statSync(path).size,
        } as Express.Multer.File;
    }

    it('adds the new photo as current, keeps the old file and emits avatars_changed', async () => {
        await fs.promises.mkdir(join(root, 'uploads', 'thumbs', '256'), {
            recursive: true,
        });
        await fs.promises.writeFile(
            join(root, 'uploads', 'avatars', 'old.png'),
            'old',
        );
        await fs.promises.writeFile(
            join(root, 'uploads', 'thumbs', '256', 'old.png.webp'),
            'thumb',
        );

        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                description: null,
                avatars: ['uploads/avatars/old.png'],
            },
        });
        const path = await writePng('new.png');
        const result = await harness.service.addGroupAvatar(
            1 as never,
            2 as never,
            uploadFile(path),
        );

        expect(result).toEqual({
            id: 1,
            avatars: ['uploads/avatars/new.png', 'uploads/avatars/old.png'],
            changed: true,
        });
        expect(harness.chatState.avatars).toEqual([
            'uploads/avatars/new.png',
            'uploads/avatars/old.png',
        ]);
        expect(fs.existsSync(path)).toBe(true);
        expect(fs.existsSync(join(root, 'uploads', 'avatars', 'old.png'))).toBe(
            true,
        );

        await flush();
        expect(harness.realtime.groupAvatarsChanged).toHaveBeenCalledWith(1, 2);
        expect(harness.realtime.groupUpdated).toHaveBeenCalledWith(
            1,
            'Team',
            ['uploads/avatars/new.png', 'uploads/avatars/old.png'],
            [2, 7],
        );
    });

    it('rejects content that is not an image and deletes the uploaded file', async () => {
        const harness = buildHarness({});
        const path = join(root, 'uploads', 'avatars', 'fake.png');
        await fs.promises.writeFile(path, 'not an image');

        await expect(
            harness.service.addGroupAvatar(
                1 as never,
                2 as never,
                {
                    path,
                    mimetype: 'image/png',
                    size: 12,
                } as Express.Multer.File,
            ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(fs.existsSync(path)).toBe(false);
        expect(harness.updates).toHaveLength(0);
    });

    it('removes the uploaded file when the transaction fails', async () => {
        const harness = buildHarness({
            transactionError: new Error('db down'),
        });
        const path = await writePng('dbfail.png');

        await expect(
            harness.service.addGroupAvatar(
                1 as never,
                2 as never,
                uploadFile(path),
            ),
        ).rejects.toThrow('db down');

        expect(fs.existsSync(path)).toBe(false);
    });

    it('clears the photo and deletes the file; a second call is idempotent', async () => {
        const path = await writePng('current.png');
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                description: null,
                avatars: ['uploads/avatars/current.png'],
            },
        });

        const first = await harness.service.removeGroupAvatar(
            1 as never,
            2 as never,
        );
        expect(first).toEqual({ id: 1, avatars: [], changed: true });
        expect(fs.existsSync(path)).toBe(false);

        const second = await harness.service.removeGroupAvatar(
            1 as never,
            2 as never,
        );
        expect(second.changed).toBe(false);
    });

    it('never deletes a file outside uploads/avatars (path traversal)', async () => {
        await fs.promises.writeFile(
            join(root, 'uploads', 'avatars', 'outside.png'),
            'inside',
        );
        await fs.promises.writeFile(
            join(root, 'uploads', 'outside.png'),
            'outside',
        );
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                description: null,
                avatars: ['../../outside.png'],
            },
        });

        await harness.service.removeGroupAvatar(1 as never, 2 as never);

        expect(fs.existsSync(join(root, 'uploads', 'outside.png'))).toBe(true);
        expect(
            fs.existsSync(join(root, 'uploads', 'avatars', 'outside.png')),
        ).toBe(false);
    });

    it('answers 400 for a private chat before touching files', async () => {
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
        const path = await writePng('private.png');

        await expect(
            harness.service.addGroupAvatar(
                1 as never,
                2 as never,
                uploadFile(path),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);

        // Validation ran before the group check and stored nothing new: the
        // caller-supplied file is the only copy and is left untouched.
        expect(harness.chatState.avatars).toEqual([]);
    });

    it('rejects the 11th photo with a clear 400 before writing the array', async () => {
        const ten = Array.from(
            { length: MAX_GROUP_AVATARS },
            (_value, index) => `uploads/avatars/photo-${index}.png`,
        );
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                avatars: ten,
            },
        });
        const path = await writePng('eleventh.png');

        await expect(
            harness.service.addGroupAvatar(
                1 as never,
                2 as never,
                uploadFile(path),
            ),
        ).rejects.toMatchObject({
            status: 400,
            message: GROUP_AVATAR_LIMIT_MESSAGE,
        });

        expect(fs.existsSync(path)).toBe(false);
        expect(harness.updates).toHaveLength(0);
        expect(harness.chatState.avatars).toHaveLength(MAX_GROUP_AVATARS);
    });

    it('early slot check answers 400 at 10 photos and passes at 9', async () => {
        const full = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                avatars: Array.from(
                    { length: MAX_GROUP_AVATARS },
                    (_value, index) => `uploads/avatars/p-${index}.png`,
                ),
            },
        });
        await expect(full.service.assertAvatarSlot(1)).rejects.toBeInstanceOf(
            BadRequestException,
        );

        const roomLeft = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                avatars: Array.from(
                    { length: MAX_GROUP_AVATARS - 1 },
                    (_value, index) => `uploads/avatars/p-${index}.png`,
                ),
            },
        });
        await expect(
            roomLeft.service.assertAvatarSlot(1),
        ).resolves.toBeUndefined();
    });

    it('promote moves the photo to index 0 and keeps the others in order', async () => {
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                avatars: [
                    'uploads/avatars/a.png',
                    'uploads/avatars/b.png',
                    'uploads/avatars/c.png',
                ],
            },
        });

        const result = await harness.service.setMainGroupAvatar(
            1 as never,
            2 as never,
            'c.png',
        );
        expect(result).toEqual({
            id: 1,
            avatars: [
                'uploads/avatars/c.png',
                'uploads/avatars/a.png',
                'uploads/avatars/b.png',
            ],
            changed: true,
        });

        const again = await harness.service.setMainGroupAvatar(
            1 as never,
            2 as never,
            'c.png',
        );
        expect(again.changed).toBe(false);
        expect(harness.updates).toHaveLength(1);
    });

    it('deleting the current photo promotes the next; the last leaves none', async () => {
        const a = await writePng('a.png');
        const b = await writePng('b.png');
        const c = await writePng('c.png');
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                avatars: [
                    'uploads/avatars/a.png',
                    'uploads/avatars/b.png',
                    'uploads/avatars/c.png',
                ],
            },
        });

        const first = await harness.service.removeGroupAvatar(
            1 as never,
            2 as never,
        );
        expect(first.avatars).toEqual([
            'uploads/avatars/b.png',
            'uploads/avatars/c.png',
        ]);
        expect(fs.existsSync(a)).toBe(false);
        expect(fs.existsSync(b)).toBe(true);

        const byName = await harness.service.removeGroupAvatarByFileName(
            1 as never,
            2 as never,
            'c.png',
        );
        expect(byName.avatars).toEqual(['uploads/avatars/b.png']);
        expect(fs.existsSync(c)).toBe(false);

        const last = await harness.service.removeGroupAvatarByFileName(
            1 as never,
            2 as never,
            'b.png',
        );
        expect(last).toEqual({ id: 1, avatars: [], changed: true });
        expect(fs.existsSync(b)).toBe(false);

        const empty = await harness.service.removeGroupAvatar(
            1 as never,
            2 as never,
        );
        expect(empty.changed).toBe(false);
    });

    it('rejects a name that is not in this chat and never touches its files', async () => {
        const mine = await writePng('mine.png');
        const harness = buildHarness({
            chat: {
                id: 1,
                type: TypeChatEnum.GRUPE,
                isBan: false,
                title: 'Team',
                avatars: ['uploads/avatars/mine.png'],
            },
        });

        await expect(
            harness.service.removeGroupAvatarByFileName(
                1 as never,
                2 as never,
                'another-chat.png',
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(fs.existsSync(mine)).toBe(true);
        expect(harness.chatState.avatars).toEqual(['uploads/avatars/mine.png']);
    });

    it('rejects path-shaped file names with 400', async () => {
        const harness = buildHarness({});
        for (const value of ['../mine.png', 'a/b.png', '..', '']) {
            await expect(
                harness.service.removeGroupAvatarByFileName(
                    1 as never,
                    2 as never,
                    value,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);
        }
    });

    it('enforces canEditInfo for admins, members and private chats', async () => {
        const allowed = buildHarness({
            caller: adminCaller([PermissionChatEnum.CHANGE_INFO_CHAT]),
        });
        await expect(
            allowed.service.setMainGroupAvatar(1 as never, 9 as never, 'x.png'),
        ).rejects.toBeInstanceOf(NotFoundException);

        const refused = buildHarness({
            caller: adminCaller([PermissionChatEnum.BAN_USER]),
        });
        await expect(
            refused.service.removeGroupAvatar(1 as never, 9 as never),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const member = buildHarness({
            caller: callerContext({
                roleName: RoleChatEnum.USER,
                role: 'member',
                isOwner: false,
                isAdmin: false,
            }),
        });
        await expect(
            member.service.removeGroupAvatarByFileName(
                1 as never,
                9 as never,
                'x.png',
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const privateChat = buildHarness({
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
            privateChat.service.setMainGroupAvatar(
                1 as never,
                2 as never,
                'x.png',
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('enforces the avatar rate limit and removes the just-stored file', async () => {
        const consume = jest.fn((): Promise<number> => {
            throw new HttpException('Too many group photo changes', 429);
        });
        const harness = buildHarness({ rateConsume: consume });
        const path = await writePng('limited.png');

        await expect(
            harness.service.addGroupAvatar(
                1 as never,
                2 as never,
                uploadFile(path),
            ),
        ).rejects.toMatchObject({ status: 429 });

        expect(fs.existsSync(path)).toBe(false);
        expect(harness.updates).toHaveLength(0);
    });
});
