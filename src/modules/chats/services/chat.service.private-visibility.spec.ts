import { ChatService } from './chat.service';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { JwtPayload } from 'src/common/types/jwt-payload.type';

/**
 * Chat-list visibility + peer batching. The visibility decision is pure
 * (`isChatVisibleInList`), and the two data sources are asserted to be ONE
 * grouped query each rather than per-chat lookups.
 */

function build(
    anyMessageIds: string[],
    latestMessages: Array<{ chatId: string; maxId: string | null }> = [],
    clearedBeforeId?: number,
) {
    const chatWithMessage = {
        id: 10,
        type: TypeChatEnum.PRIVATE,
        title: null,
        avatars: [],
        isBan: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: null,
    };
    const emptyChat = {
        ...chatWithMessage,
        id: 11,
    };

    const membershipBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndMapOne: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
            {
                chat: chatWithMessage,
                ...(clearedBeforeId === undefined ? {} : { clearedBeforeId }),
            },
            { chat: emptyChat },
        ]),
    };
    const memberRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(membershipBuilder),
        query: jest.fn().mockResolvedValue([]),
        find: jest.fn().mockResolvedValue([
            {
                chat: { id: 10 },
                user: {
                    id: 2,
                    isOnline: false,
                    lastSeen: new Date('2026-01-01T00:00:00.000Z'),
                    profile: {
                        name: 'Sara',
                        username: 'sara',
                        avatars: ['uploads/sara.png'],
                    },
                },
            },
        ]),
    };

    let rawCall = 0;
    const messageBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        // 1st query: chat ids with any message; 2nd: newest id per chat.
        getRawMany: jest.fn(() =>
            Promise.resolve(
                rawCall++ === 0
                    ? anyMessageIds.map((chatId) => ({ chatId }))
                    : latestMessages,
            ),
        ),
    };
    const messageRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(messageBuilder),
    };

    const service = new ChatService(
        {} as never,
        memberRepository as never,
        {} as never,
        messageRepository as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {
            blockersOfViewer: (): Promise<Set<number>> =>
                Promise.resolve(new Set<number>()),
        } as never,
    );

    return { service, memberRepository, messageRepository, messageBuilder };
}

describe('ChatService.getUserChats — private visibility', () => {
    it('hides an empty private chat and lists one with a message', async () => {
        const { service, memberRepository } = build(['10']);
        const chats = await service.getUserChats({
            sub: 1,
        } as unknown as JwtPayload);

        expect(chats.map((chat) => Number(chat.id))).toEqual([10]);
        // Peer data for ALL private chats comes from one joined query.
        expect(memberRepository.find).toHaveBeenCalledTimes(1);
    });

    it('hides every private chat when none has a message row', async () => {
        const { service } = build([]);
        const chats = await service.getUserChats({
            sub: 1,
        } as unknown as JwtPayload);
        expect(chats).toEqual([]);
    });

    it('counts soft-deleted messages as "has a message"', async () => {
        // The existence query selects any `messages` row and has no isDeleted
        // predicate, so a chat whose only message was deleted stays visible.
        const { service, messageBuilder } = build(['10']);
        const chats = await service.getUserChats({
            sub: 1,
        } as unknown as JwtPayload);

        expect(chats).toHaveLength(1);
        const whereClauses = messageBuilder.where.mock.calls
            .map((call: unknown[]) => String(call[0]))
            .join(' ');
        expect(whereClauses).not.toContain('isDeleted');
    });

    it('hides a chat deleted for the caller until a message newer than the boundary exists', async () => {
        // The caller deleted chat 10 when message 150 was the newest. The
        // stored latest is still 150 → hidden. Chat 11 was never deleted.
        const hidden = build(
            ['10', '11'],
            [{ chatId: '10', maxId: '150' }],
            150,
        );
        const hiddenChats = await hidden.service.getUserChats({
            sub: 1,
        } as unknown as JwtPayload);
        expect(hiddenChats.map((chat) => Number(chat.id))).toEqual([11]);

        // A new message (id 151) restores the conversation for the caller.
        const restored = build(
            ['10', '11'],
            [{ chatId: '10', maxId: '151' }],
            150,
        );
        const restoredChats = await restored.service.getUserChats({
            sub: 1,
        } as unknown as JwtPayload);
        expect(restoredChats.map((chat) => Number(chat.id))).toEqual([10, 11]);
    });

    it('serializes the peer on a private chat row', async () => {
        const { service } = build(['10']);
        const chats = await service.getUserChats({
            sub: 1,
        } as unknown as JwtPayload);

        expect(chats[0]?.peer).toEqual({
            id: 2,
            name: 'Sara',
            username: 'sara',
            avatars: ['uploads/sara.png'],
            isOnline: false,
            lastSeen: new Date('2026-01-01T00:00:00.000Z'),
        });
        expect(chats[0]?.title).toBeNull();
    });
});
