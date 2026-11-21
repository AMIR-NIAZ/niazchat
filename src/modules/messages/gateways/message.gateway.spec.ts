import { Test, TestingModule } from '@nestjs/testing';
import { MessageGateway } from './message.gateway';
import { MessageService } from '../services/message.service';
import { MessageForwardService } from '../services/message-forward.service';
import { MessageMediaService } from '../services/message-media.service';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import {
    CONTENT_HANDLERS,
    ContentResolverService,
} from '../services/content-resolver.service';
import { ReactionsService } from 'src/modules/reactions/services/reactions.service';
import { VisibilityService } from 'src/modules/visibility/visibility.service';

describe('MessageGateway', () => {
    let gateway: MessageGateway;
    let messageService: {
        create: jest.Mock;
        getPage: jest.Mock;
        edit: jest.Mock;
        delete: jest.Mock;
        pin: jest.Mock;
        unpin: jest.Mock;
        getPinned: jest.Mock;
        lastNonDeletedMessage: jest.Mock;
    };
    let chatService: { getMemberIds: jest.Mock };
    let forwardService: { forward: jest.Mock };
    let media: { getPage: jest.Mock };
    let reactions: { summariesFor: jest.Mock; myReactionsFor: jest.Mock };
    let roomEmit: jest.Mock;

    beforeEach(async () => {
        messageService = {
            create: jest.fn(),
            getPage: jest.fn(),
            edit: jest.fn(),
            delete: jest.fn().mockResolvedValue({ wasPinned: false }),
            pin: jest.fn(),
            unpin: jest.fn(),
            getPinned: jest.fn().mockResolvedValue([]),
            lastNonDeletedMessage: jest.fn().mockResolvedValue(null),
        };
        chatService = { getMemberIds: jest.fn().mockResolvedValue([1, 2]) };
        forwardService = { forward: jest.fn() };
        media = { getPage: jest.fn() };
        reactions = {
            summariesFor: jest.fn().mockResolvedValue(new Map()),
            myReactionsFor: jest.fn().mockResolvedValue(new Map()),
        };
        roomEmit = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MessageGateway,
                { provide: MessageService, useValue: messageService },
                {
                    provide: MessageForwardService,
                    useValue: forwardService,
                },
                { provide: ChatService, useValue: chatService },
                { provide: ReactionsService, useValue: reactions },
                { provide: MessageMediaService, useValue: media },
                {
                    provide: VisibilityService,
                    useValue: {
                        blockedRelationsInChat: jest.fn().mockResolvedValue([]),
                        blockersOfViewer: jest
                            .fn()
                            .mockResolvedValue(new Set()),
                        hiddenUserIdsFor: jest.fn().mockReturnValue(new Set()),
                    },
                },
                { provide: JwtAppService, useValue: {} },
                { provide: JwtService, useValue: {} },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
                { provide: getRepositoryToken(RoleChat), useValue: {} },
                { provide: CONTENT_HANDLERS, useValue: [] },
                {
                    provide: ContentResolverService,
                    useValue: {
                        resolve: jest.fn((content: string | undefined) =>
                            Promise.resolve(content ?? ''),
                        ),
                    },
                },
            ],
        }).compile();

        gateway = module.get<MessageGateway>(MessageGateway);
        (gateway as unknown as { server: unknown }).server = {
            to: jest.fn().mockReturnValue({ emit: roomEmit }),
            emit: jest.fn(),
        };
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });

    it('emits sendMessage:list and includes attachment metadata in chat-list previews', async () => {
        const message = {
            id: 100,
            content: '',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [
                {
                    id: 9,
                    originalName: 'doc.pdf',
                    mimeType: 'application/pdf',
                    size: 12,
                },
            ],
        };
        messageService.create.mockResolvedValue(message);

        const client = makeClient();
        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(client, { chatId: 10, type: 'file', attachments: [9] });
        await flushBackgroundWork();

        // Wire shape after the WS standardization: serialized message with
        // numeric ids and top-level chatId/senderId (see ws-serializer.utils).
        expect(roomEmit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({
                id: 100,
                content: '',
                chatId: 10,
                senderId: 1,
                attachments: [
                    expect.objectContaining({
                        id: 9,
                        originalName: 'doc.pdf',
                        mimeType: 'application/pdf',
                        size: 12,
                    }),
                ],
            }),
        );

        // chatlist:updated is emitted per member room via server.to(userRoom).emit
        expect(roomEmit).toHaveBeenCalledWith('chatlist:updated', {
            chatId: 10,
            lastMessage: {
                id: 100,
                content: '',
                senderId: 1,
                createdAt: message.createdAt,
                type: 'text',
                meta: null,
                attachments: [
                    {
                        id: 9,
                        originalName: 'doc.pdf',
                        mimeType: 'application/pdf',
                        size: 12,
                        kind: 'file',
                    },
                ],
            },
        });
        expect(chatService.getMemberIds).toHaveBeenCalledWith(10);
    });

    it('serializes video metadata in sendMessage:list and the chat-list preview', async () => {
        const createdAt = new Date('2026-01-01');
        const message = {
            id: 110,
            content: '',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt,
            attachments: [
                {
                    id: 11,
                    originalName: 'clip.mp4',
                    mimeType: 'video/mp4',
                    size: 2048,
                    width: 1280,
                    height: 720,
                    duration: '12.3',
                    posterPath: '10/abc.poster.webp',
                    createdAt,
                },
            ],
        };
        messageService.create.mockResolvedValue(message);

        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(makeClient(), {
            chatId: 10,
            content: '',
            type: 'video',
            attachments: [11],
        });
        await flushBackgroundWork();

        const expectedVideo = {
            kind: 'video',
            width: 1280,
            height: 720,
            duration: 12.3,
            hasPoster: true,
        };
        expect(roomEmit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({
                id: 110,
                attachments: [
                    expect.objectContaining({ id: 11, ...expectedVideo }),
                ],
            }),
        );
        expect(roomEmit).toHaveBeenCalledWith('chatlist:updated', {
            chatId: 10,
            lastMessage: expect.objectContaining({
                id: 110,
                attachments: [
                    expect.objectContaining({ id: 11, ...expectedVideo }),
                ],
            }),
        });

        // The internal poster location is never exposed.
        const serialized = JSON.stringify(
            roomEmit.mock.calls.filter(
                (call: unknown[]) => call[0] !== 'chatlist:updated',
            ),
        );
        expect(serialized).not.toContain('posterPath');
        expect(serialized).not.toContain('abc.poster');
    });

    it('carries video metadata in getMessages history pages', async () => {
        const createdAt = new Date('2026-01-01');
        messageService.getPage.mockResolvedValue({
            messages: [
                {
                    id: 111,
                    content: '',
                    chat: { id: 10 },
                    sender: { id: 1 },
                    type: { id: 3, name: 'video' },
                    createdAt,
                    attachments: [
                        {
                            id: 12,
                            originalName: 'clip.webm',
                            mimeType: 'video/webm',
                            size: 4096,
                            width: 720,
                            height: 1280,
                            duration: 4.5,
                            posterPath: null,
                            createdAt,
                        },
                    ],
                },
            ],
            hasMore: false,
            nextCursor: 111,
        });

        const ack = await (
            gateway as unknown as {
                getMessages: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{
                    data: { messages: Array<Record<string, unknown>> };
                }>;
            }
        ).getMessages(makeClient(), { chatId: 10 });

        expect(ack.data.messages[0]?.attachments).toEqual([
            expect.objectContaining({
                id: 12,
                kind: 'video',
                width: 720,
                height: 1280,
                duration: 4.5,
                hasPoster: false,
            }),
        ]);
    });

    it('loads reactions once for the page and personalizes myReaction', async () => {
        messageService.getPage.mockResolvedValue({
            messages: [
                {
                    id: 121,
                    content: 'one',
                    chat: { id: 10 },
                    sender: { id: 2 },
                    type: { id: 1, name: 'text' },
                    createdAt: new Date('2026-01-01'),
                    attachments: [],
                },
                {
                    id: 120,
                    content: 'two',
                    chat: { id: 10 },
                    sender: { id: 1 },
                    type: { id: 1, name: 'text' },
                    createdAt: new Date('2026-01-01'),
                    attachments: [],
                },
            ],
            hasMore: false,
            nextCursor: 120,
        });
        reactions.summariesFor.mockResolvedValue(
            new Map([[121, [{ emoji: '👍', count: 2 }]]]),
        );
        reactions.myReactionsFor.mockResolvedValue(new Map([[121, '👍']]));

        const ack = await (
            gateway as unknown as {
                getMessages: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{
                    data: { messages: Array<Record<string, unknown>> };
                }>;
            }
        ).getMessages(makeClient(), { chatId: 10 });

        expect(reactions.summariesFor).toHaveBeenCalledTimes(1);
        expect(reactions.summariesFor).toHaveBeenCalledWith([121, 120]);
        expect(reactions.myReactionsFor).toHaveBeenCalledTimes(1);
        expect(reactions.myReactionsFor).toHaveBeenCalledWith([121, 120], 1);
        expect(ack.data.messages[0]?.reactions).toEqual([
            { emoji: '👍', count: 2 },
        ]);
        expect(ack.data.messages[0]?.myReaction).toBe('👍');
        expect(ack.data.messages[1]?.myReaction).toBeNull();
    });

    it('keeps reactions on the edit echo without personalizing it', async () => {
        const edited = {
            id: 130,
            content: 'edited',
            chat: { id: 10 },
            sender: { id: 1 },
            type: { id: 1, name: 'text' },
            createdAt: new Date('2026-01-01'),
            isEdited: true,
            attachments: [],
        };
        messageService.edit.mockResolvedValue(edited);
        reactions.summariesFor.mockResolvedValue(
            new Map([[130, [{ emoji: '❤️', count: 1 }]]]),
        );

        const ack = await (
            gateway as unknown as {
                editMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{
                    data: Record<string, unknown>;
                }>;
            }
        ).editMessage(makeClient(), {
            chatId: 10,
            messageId: 130,
            newContent: 'edited',
        });

        expect(roomEmit).toHaveBeenCalledWith(
            'editMessage:list',
            expect.objectContaining({
                id: 130,
                reactions: [{ emoji: '❤️', count: 1 }],
            }),
        );
        expect(ack.data.reactions).toEqual([{ emoji: '❤️', count: 1 }]);
        expect(ack.data.myReaction).toBeUndefined();
    });

    it('still emits chat-list updates for plain text messages', async () => {
        const message = {
            id: 101,
            content: 'hi',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [],
        };
        messageService.create.mockResolvedValue(message);

        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(makeClient(), {
            chatId: 10,
            content: 'hi',
            type: 'text',
        });
        await flushBackgroundWork();

        expect(roomEmit).toHaveBeenCalledWith(
            'chatlist:updated',
            expect.objectContaining({ chatId: 10 }),
        );
    });

    it('emits the echo directly to a sender socket that is not in the room', async () => {
        messageService.create.mockResolvedValue({
            id: 102,
            content: 'hi',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [],
        });

        const client = makeClient([]);
        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(client, { chatId: 10, content: 'hi', type: 'text' });

        expect(client.emit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({ id: 102, chatId: 10, senderId: 1 }),
        );
    });

    it('broadcasts pinMessage:list to the chat room exactly once', async () => {
        messageService.pin.mockResolvedValue({
            message: {
                id: 200,
                content: 'pin me',
                chat: { id: 10 },
                sender: { id: 1 },
                type: { id: 1, name: 'text' },
                createdAt: new Date('2026-01-01'),
                updatedAt: new Date('2026-01-01'),
                isPinned: true,
                pinnedAt: new Date('2026-01-01'),
                attachments: [],
            },
            changed: true,
        });

        const client = makeClient();
        const result = await (
            gateway as unknown as {
                pinMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{ ok: boolean; data: unknown }>;
            }
        ).pinMessage(client, { chatId: 10, messageId: 200 });

        expect(roomEmit).toHaveBeenCalledTimes(1);
        expect(roomEmit).toHaveBeenCalledWith(
            'pinMessage:list',
            expect.objectContaining({
                chatId: 10,
                message: expect.objectContaining({
                    id: 200,
                    isPinned: true,
                }),
            }),
        );
        expect(result).toMatchObject({
            ok: true,
            data: { alreadyPinned: false },
        });
    });

    it('does not rebroadcast a duplicate pin', async () => {
        messageService.pin.mockResolvedValue({
            message: {
                id: 200,
                chat: { id: 10 },
                sender: { id: 1 },
                type: { id: 1, name: 'text' },
                isPinned: true,
                attachments: [],
            },
            changed: false,
        });

        const result = await (
            gateway as unknown as {
                pinMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{ ok: boolean; data: unknown }>;
            }
        ).pinMessage(makeClient(), { chatId: 10, messageId: 200 });

        expect(roomEmit).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            ok: true,
            data: { alreadyPinned: true },
        });
    });

    it('broadcasts unpinMessage:list and its ack', async () => {
        messageService.unpin.mockResolvedValue({
            messageId: 200,
            changed: true,
        });

        const result = await (
            gateway as unknown as {
                unpinMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{ ok: boolean; data: unknown }>;
            }
        ).unpinMessage(makeClient(), { chatId: 10, messageId: 200 });

        expect(roomEmit).toHaveBeenCalledWith('unpinMessage:list', {
            chatId: 10,
            messageId: 200,
        });
        expect(result).toMatchObject({
            ok: true,
            data: { alreadyUnpinned: false },
        });
    });

    it('unpins a deleted pinned message for the room', async () => {
        messageService.delete.mockResolvedValue({ wasPinned: true });

        await (
            gateway as unknown as {
                deleteMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).deleteMessage(makeClient(), { chatId: 10, messageId: 200 });

        expect(roomEmit).toHaveBeenCalledWith('deleteMessage:list', 200);
        expect(roomEmit).toHaveBeenCalledWith('unpinMessage:list', {
            chatId: 10,
            messageId: 200,
        });
    });

    it('returns the full pinned list from getPinnedMessages', async () => {
        messageService.getPinned.mockResolvedValue([
            {
                id: 200,
                chat: { id: 10 },
                sender: { id: 1 },
                type: { id: 1, name: 'text' },
                isPinned: true,
                attachments: [],
            },
        ]);

        const result = await (
            gateway as unknown as {
                getPinnedMessages: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{ ok: boolean; data: unknown[] }>;
            }
        ).getPinnedMessages(makeClient(), { chatId: 10 });

        expect(result.ok).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({ id: 200, isPinned: true });
    });

    it('does not emit a duplicate echo when the sender is already in the room', async () => {
        messageService.create.mockResolvedValue({
            id: 103,
            content: 'hi',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [],
        });

        const client = makeClient(['chat:10']);
        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(client, { chatId: 10, content: 'hi', type: 'text' });

        expect(client.emit).not.toHaveBeenCalled();
        expect(roomEmit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({ id: 103 }),
        );
    });

    it('returns a getChatMedia page for the viewer with the default page size', async () => {
        media.getPage.mockResolvedValue({
            items: [
                {
                    id: 5,
                    messageId: 200,
                    createdAt: '2026-01-01T00:00:00.000Z',
                },
            ],
            nextCursor: 'cursor-2',
        });

        const result = await (
            gateway as unknown as {
                getChatMedia: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<{ ok: boolean; data: unknown }>;
            }
        ).getChatMedia(makeClient(), {
            chatId: 10,
            type: 'links',
            cursor: 'cursor-1',
        });

        expect(media.getPage).toHaveBeenCalledWith(
            1,
            10,
            'links',
            'cursor-1',
            30,
        );
        expect(result).toEqual({
            ok: true,
            data: {
                items: [
                    {
                        id: 5,
                        messageId: 200,
                        createdAt: '2026-01-01T00:00:00.000Z',
                    },
                ],
                nextCursor: 'cursor-2',
            },
        });
    });

    /** Minimal SocketAuth stand-in: rooms + per-socket emit. */
    function makeClient(rooms: string[] = ['chat:10']) {
        return {
            data: { user: { sub: 1 } },
            rooms: new Set(rooms),
            emit: jest.fn(),
        };
    }

    /** `notifyChatList` is fire-and-forget; let its microtasks run. */
    function flushBackgroundWork(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }
});
