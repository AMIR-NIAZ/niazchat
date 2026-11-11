import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chats.gateway';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from '../services/chat.service';
import { GroupRealtimeService } from '../services/group-realtime.service';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { ChatMember } from '../entities/chat_members.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { chatRoom, userRoom } from 'src/common/utils/roomCreator.utils';

describe('ChatGateway', () => {
    let gateway: ChatGateway;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChatGateway,
                { provide: ChatService, useValue: {} },
                { provide: GroupRealtimeService, useValue: {} },
                { provide: JwtAppService, useValue: {} },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
                { provide: getRepositoryToken(RoleChat), useValue: {} },
            ],
        }).compile();

        gateway = module.get<ChatGateway>(ChatGateway);
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });
});

describe('ChatGateway.joinChat / room switching', () => {
    function setup() {
        const emit = jest.fn();
        const join = jest.fn(() => Promise.resolve());
        const leave = jest.fn(() => Promise.resolve());
        const fetchSockets = jest.fn(() => Promise.resolve([]));
        const chatService = {
            getInfoChat: jest.fn((id: number) =>
                Promise.resolve({
                    id,
                    type: 'private',
                    avatars: [],
                    isBan: false,
                    title: null,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                }),
            ),
            getChatSummary: jest.fn().mockResolvedValue({
                myRole: 'user',
                membersCount: 2,
            }),
            getChatSeenState: jest.fn().mockResolvedValue({
                myLastSeenId: null,
                othersLastSeenId: null,
            }),
            getPeerForChat: jest.fn().mockResolvedValue(null),
            getUserDisplayName: jest.fn().mockResolvedValue('Me'),
            isActiveMember: jest.fn().mockResolvedValue(true),
        };
        const server = {
            to: jest.fn(() => ({ emit })),
            in: jest.fn(() => ({ fetchSockets })),
        };
        const gateway = new ChatGateway(chatService as never, {} as never);
        (gateway as unknown as { server: typeof server }).server = server;
        const client = {
            data: { user: { sub: 7 } } as {
                user: { sub: number };
                chatId?: number;
            },
            join,
            leave,
            emit,
            rooms: new Set<string>(),
        };
        return { gateway, chatService, client, join, leave, emit, server };
    }

    it('switching chats leaves the previous room before joining the next', async () => {
        const { gateway, client, join, leave, emit } = setup();

        await gateway.joinChat(client as never, { chatId: 1 } as never);
        expect(join).toHaveBeenCalledWith('chat:1');
        expect(client.data.chatId).toBe(1);

        await gateway.joinChat(client as never, { chatId: 2 } as never);
        expect(leave).toHaveBeenCalledWith('chat:1');
        expect(join).toHaveBeenCalledWith('chat:2');
        expect(client.data.chatId).toBe(2);

        // Joining is NOT reading: it must never advance or announce a receipt.
        expect(emit).not.toHaveBeenCalledWith('seen', expect.anything());
    });

    it('re-joining the same chat is self-healing and does not leave the room', async () => {
        const { gateway, client, join, leave } = setup();

        await gateway.joinChat(client as never, { chatId: 3 } as never);
        await gateway.joinChat(client as never, { chatId: 3 } as never);

        expect(leave).not.toHaveBeenCalled();
        expect(join).toHaveBeenCalledTimes(2);
        expect(join).toHaveBeenLastCalledWith('chat:3');
        expect(client.data.chatId).toBe(3);
    });

    it('ignores a late leave for a chat this socket is no longer on', async () => {
        const { gateway, client, leave } = setup();

        await gateway.joinChat(client as never, { chatId: 5 } as never);
        // A stale unmount cleanup from the previously open screen.
        await gateway.leaveChat(client as never, { chatId: 4 } as never);

        expect(leave).not.toHaveBeenCalled();
        expect(client.data.chatId).toBe(5);
    });
});

describe('ChatGateway.joinChat consistency', () => {
    interface Options {
        chatId?: number;
        type?: 'private' | 'groupe';
        peer?: { id: number } | null;
        summaryRejects?: boolean;
        joinRejects?: boolean;
        countRejects?: boolean;
    }

    function setup(options: Options = {}) {
        const emit = jest.fn();
        const join = jest.fn(() =>
            options.joinRejects === true
                ? Promise.reject(new Error('adapter down'))
                : Promise.resolve(),
        );
        const leave = jest.fn(() => Promise.resolve());
        const fetchSockets = jest.fn(() =>
            options.countRejects === true
                ? Promise.reject(new Error('adapter down'))
                : Promise.resolve([]),
        );
        const chatService = {
            getInfoChat: jest.fn((id: number) =>
                Promise.resolve({
                    id,
                    type: options.type ?? 'private',
                    avatars: [],
                    isBan: false,
                    title: null,
                    description: null,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                }),
            ),
            getChatSummary: jest.fn(() =>
                options.summaryRejects === true
                    ? Promise.reject(new Error('db down'))
                    : Promise.resolve({ myRole: 'user', membersCount: 2 }),
            ),
            getChatSeenState: jest.fn().mockResolvedValue({
                myLastSeenId: null,
                othersLastSeenId: null,
            }),
            getPeerForChat: jest.fn().mockResolvedValue(options.peer ?? null),
            getUserDisplayName: jest.fn().mockResolvedValue('Me'),
        };
        const server = {
            to: jest.fn(() => ({ emit })),
            in: jest.fn(() => ({ fetchSockets })),
        };
        const gateway = new ChatGateway(chatService as never, {} as never);
        (gateway as unknown as { server: typeof server }).server = server;
        const client = {
            data: {
                user: { sub: 7 },
                chatId: options.chatId,
            } as {
                user: { sub: number };
                chatId?: number;
                chatType?: string;
                userName?: string;
            },
            join,
            leave,
            emit,
            rooms: new Set<string>(),
        };
        return { gateway, client, join, leave, emit };
    }

    it('leaves the socket untouched when info resolution fails', async () => {
        const { gateway, client, join, leave } = setup({
            chatId: 1 as never,
            summaryRejects: true,
        });
        (client.data as { chatId?: number }).chatId = 1;

        await expect(
            gateway.joinChat(client as never, { chatId: 2 } as never),
        ).rejects.toThrow('db down');

        expect(leave).not.toHaveBeenCalled();
        expect(join).not.toHaveBeenCalled();
        expect(client.data.chatId).toBe(1);
    });

    it('never claims a chat whose room join failed', async () => {
        const { gateway, client, leave } = setup({
            chatId: 1 as never,
            joinRejects: true,
        });
        (client.data as { chatId?: number }).chatId = 1;

        await expect(
            gateway.joinChat(client as never, { chatId: 2 } as never),
        ).rejects.toThrow('adapter down');

        // The previous room was left, so the honest state is "no active chat".
        expect(leave).toHaveBeenCalledWith('chat:1');
        expect(client.data.chatId).toBeUndefined();
    });

    it('joins private and group chats through the same guarded path', async () => {
        const group = setup({ type: 'groupe' });
        const groupAck = await group.gateway.joinChat(
            group.client as never,
            { chatId: 10 } as never,
        );
        expect(group.join).toHaveBeenCalledWith('chat:10');
        expect(group.client.data.chatId).toBe(10);
        expect((groupAck as { data: { peer: unknown } }).data.peer).toBeNull();

        const privateChat = setup({ type: 'private', peer: { id: 9 } });
        const privateAck = await privateChat.gateway.joinChat(
            privateChat.client as never,
            { chatId: 11 } as never,
        );
        expect(privateChat.join).toHaveBeenCalledWith('chat:11');
        expect(privateChat.client.data.chatId).toBe(11);
        expect((privateAck as { data: { peer: unknown } }).data.peer).toEqual({
            id: 9,
        });
    });

    it('an advisory online-count failure never fails the join', async () => {
        const { gateway, client } = setup({ countRejects: true });

        const ack = await gateway.joinChat(
            client as never,
            {
                chatId: 12,
            } as never,
        );

        expect(ack).toMatchObject({ ok: true });
        expect(client.data.chatId).toBe(12);
    });

    it('a leave without a chat id still ends the current chat (old clients)', async () => {
        const { gateway, client, leave } = setup({ chatId: 4 as never });
        (client.data as { chatId?: number }).chatId = 4;

        await gateway.leaveChat(client as never, undefined as never);

        expect(leave).toHaveBeenCalledWith('chat:4');
        expect(client.data.chatId).toBeUndefined();
    });
});

describe('ChatGateway.markSeen', () => {
    function setup(result: { lastSeenId: number; changed: boolean }) {
        const emit = jest.fn();
        const to = jest.fn(() => ({ emit }));
        const chatService = {
            markSeen: jest.fn().mockResolvedValue(result),
        };
        const gateway = new ChatGateway(chatService as never, {} as never);
        (gateway as unknown as { server: { to: typeof to } }).server = { to };
        return { gateway, chatService, emit, to };
    }

    const client = { data: { user: { sub: 7 } } } as never;
    const dto = { chatId: 1, lastSeenId: 42 } as never;

    it('persists the receipt and notifies the room and the reader devices', async () => {
        const { gateway, chatService, emit, to } = setup({
            lastSeenId: 42,
            changed: true,
        });

        const ack = await gateway.markSeen(client, dto);

        expect(chatService.markSeen).toHaveBeenCalledWith(1, 7, 42);
        expect(to).toHaveBeenNthCalledWith(1, chatRoom(1 as never));
        expect(to).toHaveBeenNthCalledWith(2, userRoom(7 as never));
        expect(emit).toHaveBeenCalledWith('seen', {
            chatId: 1,
            userId: 7,
            lastSeenId: 42,
        });
        expect(emit).toHaveBeenCalledWith('chat:read', {
            chatId: 1,
            unreadCount: 0,
        });
        expect(ack).toEqual({ ok: true, data: { lastSeenId: 42 } });
    });

    it('emits nothing when the position did not advance', async () => {
        const { gateway, emit, to } = setup({
            lastSeenId: 42,
            changed: false,
        });

        const ack = await gateway.markSeen(client, dto);

        expect(to).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
        expect(ack).toEqual({ ok: true, data: { lastSeenId: 42 } });
    });
});
