import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import {
    DEFAULT_MEMBER_PERMISSIONS,
    type MemberPermissionsConfig,
} from '../utils/member-permissions.util';
import { GroupMemberPermissionsService } from './group-member-permissions.service';

interface CallerOverrides {
    isOwner?: boolean;
    isAdmin?: boolean;
    permissions?: string[];
    role?: string;
}

describe('GroupMemberPermissionsService', () => {
    const CHAT_ID = 1 as never;
    const CALLER_ID = 7 as never;

    let chat: {
        id: number;
        type: TypeChatEnum;
        isBan: boolean;
        memberPermissions: MemberPermissionsConfig;
    };
    let memberRows: Array<{ id: number; role: { name: string } }>;
    let grants: Array<{ permission: { name: string } }>;
    let update: jest.Mock;
    let transaction: jest.Mock;
    let permissions: {
        getCallerContext: jest.Mock;
        assertGroup: jest.Mock;
    };
    let realtime: { groupMemberPermissionsChanged: jest.Mock };
    let service: GroupMemberPermissionsService;

    const callerFor = (overrides: CallerOverrides = {}) => ({
        chat,
        member: {},
        memberIds: [1],
        roleName: overrides.role ?? RoleChatEnum.USER,
        role: 'member',
        permissions: overrides.permissions ?? [],
        isOwner: overrides.isOwner ?? false,
        isAdmin: overrides.isAdmin ?? false,
    });

    beforeEach(() => {
        chat = {
            id: 1,
            type: TypeChatEnum.GRUPE,
            isBan: false,
            memberPermissions: { ...DEFAULT_MEMBER_PERMISSIONS },
        };
        memberRows = [{ id: 1, role: { name: RoleChatEnum.USER } }];
        grants = [];
        update = jest.fn(
            (
                _id: unknown,
                values: { memberPermissions: MemberPermissionsConfig },
            ) => {
                chat.memberPermissions = values.memberPermissions;
            },
        );

        const chatQuery = {
            where: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn(() => chat),
        };
        const memberQuery = {
            innerJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getMany: jest.fn(() => memberRows),
        };
        const manager = {
            getRepository: (entity: unknown) => {
                if (entity === Chat) {
                    return {
                        createQueryBuilder: () => chatQuery,
                        update,
                    };
                }
                if (entity === ChatMember) {
                    return { createQueryBuilder: () => memberQuery };
                }
                if (entity === PermissionAdmin) {
                    return { find: jest.fn(() => grants) };
                }
                throw new Error('unexpected repository');
            },
        };

        transaction = jest.fn((cb: (m: unknown) => Promise<unknown>) =>
            cb(manager),
        );
        permissions = {
            getCallerContext: jest.fn(() => callerFor()),
            assertGroup: jest.fn(),
        };
        realtime = { groupMemberPermissionsChanged: jest.fn() };
        service = new GroupMemberPermissionsService(
            { transaction } as never,
            permissions as never,
            realtime as never,
        );
    });

    describe('getConfig', () => {
        it('returns the complete config and canEdit=false for a member', async () => {
            chat.memberPermissions = {
                ...DEFAULT_MEMBER_PERMISSIONS,
            } as never;
            await expect(
                service.getConfig(CHAT_ID, CALLER_ID),
            ).resolves.toEqual({
                chatId: 1,
                permissions: { ...DEFAULT_MEMBER_PERMISSIONS },
                canEdit: false,
            });
        });

        it('fills defaults for a legacy partial object', async () => {
            chat.memberPermissions = { send_messages: false } as never;
            const result = await service.getConfig(CHAT_ID, CALLER_ID);
            expect(result.permissions).toEqual({
                ...DEFAULT_MEMBER_PERMISSIONS,
                send_messages: false,
            });
        });

        it('lets the owner edit', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            await expect(
                service.getConfig(CHAT_ID, CALLER_ID),
            ).resolves.toMatchObject({ canEdit: true });
        });

        it('lets an admin with manage_permissions edit', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({
                    isAdmin: true,
                    role: RoleChatEnum.ADMIN,
                    permissions: ['manage_permissions'],
                }),
            );
            await expect(
                service.getConfig(CHAT_ID, CALLER_ID),
            ).resolves.toMatchObject({ canEdit: true });
        });
    });

    describe('updateConfig', () => {
        it('rejects a regular member before touching the database', async () => {
            await expect(
                service.updateConfig(CHAT_ID, CALLER_ID, {
                    send_messages: false,
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(transaction).not.toHaveBeenCalled();
        });

        it('rejects unknown and non-boolean keys with 400', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true }),
            );

            await expect(
                service.updateConfig(CHAT_ID, CALLER_ID, { nope: true }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.updateConfig(CHAT_ID, CALLER_ID, {
                    send_messages: 'false',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.updateConfig(CHAT_ID, CALLER_ID, {}),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(transaction).not.toHaveBeenCalled();
        });

        it('merges a partial patch, persists it and broadcasts once', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            memberRows = [{ id: 1, role: { name: RoleChatEnum.MANAGER } }];

            const result = await service.updateConfig(CHAT_ID, CALLER_ID, {
                send_messages: false,
                pin_messages: true,
            });

            const expected = {
                ...DEFAULT_MEMBER_PERMISSIONS,
                send_messages: false,
                pin_messages: true,
            };
            expect(result).toEqual({
                chatId: 1,
                permissions: expected,
                canEdit: true,
                changed: true,
            });
            expect(update).toHaveBeenCalledWith(1, {
                memberPermissions: expected,
            });
            expect(realtime.groupMemberPermissionsChanged).toHaveBeenCalledWith(
                1,
                expected,
            );
        });

        it('is idempotent: an unchanged patch writes and broadcasts nothing', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            memberRows = [{ id: 1, role: { name: RoleChatEnum.MANAGER } }];

            const result = await service.updateConfig(CHAT_ID, CALLER_ID, {
                send_messages: true,
            });

            expect(result.changed).toBe(false);
            expect(update).not.toHaveBeenCalled();
            expect(
                realtime.groupMemberPermissionsChanged,
            ).not.toHaveBeenCalled();
        });

        it('lets an admin with manage_permissions update', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({
                    isAdmin: true,
                    role: RoleChatEnum.ADMIN,
                    permissions: ['manage_permissions'],
                }),
            );
            memberRows = [{ id: 1, role: { name: RoleChatEnum.ADMIN } }];
            grants = [{ permission: { name: 'manage_permissions' } }];

            await expect(
                service.updateConfig(CHAT_ID, CALLER_ID, {
                    add_members: true,
                }),
            ).resolves.toMatchObject({
                changed: true,
                permissions: {
                    ...DEFAULT_MEMBER_PERMISSIONS,
                    add_members: true,
                },
            });
        });

        it('re-checks admin grants under the lock and rejects a lost grant', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({
                    isAdmin: true,
                    role: RoleChatEnum.ADMIN,
                    permissions: ['manage_permissions'],
                }),
            );
            memberRows = [{ id: 1, role: { name: RoleChatEnum.ADMIN } }];
            grants = [];

            await expect(
                service.updateConfig(CHAT_ID, CALLER_ID, {
                    add_members: true,
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(update).not.toHaveBeenCalled();
        });

        it('keeps fields from two different patches (field-wise merge)', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            memberRows = [{ id: 1, role: { name: RoleChatEnum.MANAGER } }];

            await service.updateConfig(CHAT_ID, CALLER_ID, {
                send_links: false,
            });
            const result = await service.updateConfig(CHAT_ID, CALLER_ID, {
                pin_messages: true,
            });

            expect(result.permissions).toEqual({
                ...DEFAULT_MEMBER_PERMISSIONS,
                send_links: false,
                pin_messages: true,
            });
            expect(
                realtime.groupMemberPermissionsChanged,
            ).toHaveBeenLastCalledWith(1, {
                ...DEFAULT_MEMBER_PERMISSIONS,
                send_links: false,
                pin_messages: true,
            });
        });
    });
});
