import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { ChatService } from './chat.service';

jest.mock('../utils/service-message.util', () => ({
    createServiceMessage: jest.fn().mockResolvedValue({ id: 900 }),
}));

/**
 * `POST /chats/manage/:chatId/leave` contract, at the service boundary:
 *   - an ordinary member's own membership row is removed,
 *   - an owner is rejected (no ownership transfer),
 *   - a caller without a membership row (non-member) is rejected.
 * Every case passes the authenticated user id and the URL chat id through
 * unchanged, and only a successful leave touches the database.
 */
describe('ChatService.leaveChat', () => {
    const CHAT_ID = 21;
    const CALLER_ID = 39;

    interface SetupOptions {
        caller: Record<string, unknown> | Error;
    }

    function setup(options: SetupOptions) {
        const removed: unknown[] = [];
        const permissionDeletes: unknown[] = [];

        const manager = {
            getRepository: (entity: unknown) => {
                if (entity === PermissionAdmin) {
                    return {
                        delete: (criteria: unknown): Promise<void> => {
                            permissionDeletes.push(criteria);
                            return Promise.resolve();
                        },
                    };
                }
                if (entity === ChatMember) {
                    return {
                        remove: (row: unknown): Promise<unknown> => {
                            removed.push(row);
                            return Promise.resolve(row);
                        },
                    };
                }
                throw new Error('unexpected repository');
            },
        };

        const countBuilder = {
            innerJoin: () => countBuilder,
            where: () => countBuilder,
            andWhere: () => countBuilder,
            select: () => countBuilder,
            getRawOne: (): Promise<{ count: string }> =>
                Promise.resolve({ count: '3' }),
        };

        const memberRepository = {
            manager: {
                transaction: <T>(
                    work: (entityManager: unknown) => Promise<T>,
                ): Promise<T> => work(manager),
            },
            find: (): Promise<unknown[]> =>
                Promise.resolve([
                    { user: { id: CALLER_ID } },
                    { user: { id: 1 } },
                ]),
            createQueryBuilder: () => countBuilder,
        };

        const access = {
            getCallerContext: jest.fn(() => {
                if (options.caller instanceof Error) {
                    return Promise.reject(options.caller);
                }
                return Promise.resolve(options.caller);
            }),
            assertUsableGroup: jest.fn(),
        };

        const groupRealtime = {
            groupRemoved: jest.fn(),
            groupChanged: jest.fn(),
            broadcastServiceMessage: jest.fn(),
            membersCountChanged: jest.fn(),
        };

        const service = new ChatService(
            {} as never,
            memberRepository as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            access as never,
            groupRealtime as never,
            {
                blockersOfViewer: () => Promise.resolve(new Set<number>()),
            } as never,
        );

        return { service, access, groupRealtime, removed, permissionDeletes };
    }

    function memberCaller() {
        return {
            caller: {
                chat: { id: CHAT_ID, type: TypeChatEnum.GRUPE, isBan: false },
                member: { id: 138 },
                roleName: RoleChatEnum.USER,
                permissions: [],
                isManager: false,
                isAdmin: false,
            },
        };
    }

    it('removes an ordinary member and notifies the group', async () => {
        const { service, access, groupRealtime, removed, permissionDeletes } =
            setup(memberCaller());

        const result = await service.leaveChat(
            CHAT_ID as never,
            CALLER_ID as never,
        );

        // Same authenticated user + chat id from the URL all the way down.
        expect(access.getCallerContext).toHaveBeenCalledWith(
            CHAT_ID,
            CALLER_ID,
        );
        expect(removed).toEqual([{ id: 138 }]);
        expect(permissionDeletes).toEqual([{ member: { id: 138 } }]);
        expect(groupRealtime.groupRemoved).toHaveBeenCalledWith(
            CHAT_ID,
            CALLER_ID,
            'left',
        );
        expect(groupRealtime.groupChanged).toHaveBeenCalledWith(
            CHAT_ID,
            'member_left',
        );
        expect(groupRealtime.broadcastServiceMessage).toHaveBeenCalledWith(
            { id: 900 },
            [CALLER_ID, 1],
        );
        expect(groupRealtime.membersCountChanged).toHaveBeenCalledWith(
            CHAT_ID,
            3,
        );
        expect(result).toEqual({
            message: 'you have left the group',
            chatId: CHAT_ID,
        });
    });

    it('rejects the group owner and leaves membership untouched', async () => {
        const { service, groupRealtime, removed } = setup({
            caller: {
                chat: { id: CHAT_ID, type: TypeChatEnum.GRUPE, isBan: false },
                member: { id: 7 },
                roleName: RoleChatEnum.MANAGER,
                permissions: [],
                isManager: true,
                isAdmin: false,
            },
        });

        await expect(
            service.leaveChat(CHAT_ID as never, 1 as never),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(removed).toEqual([]);
        expect(groupRealtime.groupRemoved).not.toHaveBeenCalled();
    });

    it('rejects a caller with no membership row (non-member)', async () => {
        const { service, groupRealtime, removed } = setup({
            caller: new ForbiddenException(
                'you are not a member of this group',
            ),
        });

        await expect(
            service.leaveChat(CHAT_ID as never, 99 as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(removed).toEqual([]);
        expect(groupRealtime.groupRemoved).not.toHaveBeenCalled();
    });
});
