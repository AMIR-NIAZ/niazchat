import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
} from '@nestjs/common';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { MemberPermissionOverride } from '../entities/member_permission_override.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import {
    DEFAULT_MEMBER_PERMISSIONS,
    type MemberPermissionsConfig,
    type StoredMemberPermissionOverrides,
    normalizeMemberPermissionOverrides,
} from '../utils/member-permissions.util';
import { MemberPermissionOverridesService } from './member-permission-overrides.service';

interface CallerOptions {
    isOwner?: boolean;
    isAdmin?: boolean;
    permissions?: string[];
    role?: RoleChatEnum;
}

describe('MemberPermissionOverridesService', () => {
    const CHAT_ID = 1 as never;
    const CALLER_ID = 7 as never;
    const TARGET_USER_ID = 9;
    const TARGET_MEMBER_ID = 10;

    let chat: {
        id: number;
        type: TypeChatEnum;
        isBan: boolean;
        memberPermissions: MemberPermissionsConfig;
    };
    let stored: StoredMemberPermissionOverrides | null;
    let tableHasRow: boolean;
    let targetRole: RoleChatEnum;
    let callerRows: Array<{ id: number; role: { name: string } }>;
    let grants: Array<{ permission: { name: string } }>;
    let target: {
        id: number;
        user: { id: number };
        role: { name: string };
    };
    let permissions: {
        getCallerContext: jest.Mock;
        assertGroup: jest.Mock;
    };
    let resolver: { getOverrides: jest.Mock };
    let realtime: { memberPermissionOverridesChanged: jest.Mock };
    let rateLimit: { consume: jest.Mock };
    let transaction: jest.Mock;
    let repositoryInsert: jest.Mock;
    let repositoryUpdate: jest.Mock;
    let repositoryDelete: jest.Mock;
    let service: MemberPermissionOverridesService;

    const callerFor = (options: CallerOptions = {}) => ({
        chat,
        member: { id: 100 },
        memberIds: [100],
        roleName: options.role ?? RoleChatEnum.USER,
        role: options.isOwner ? 'owner' : options.isAdmin ? 'admin' : 'member',
        permissions: options.permissions ?? [],
        isOwner: options.isOwner ?? false,
        isAdmin: options.isAdmin ?? false,
        effectiveMemberPermissions: { ...DEFAULT_MEMBER_PERMISSIONS },
    });

    beforeEach(() => {
        chat = {
            id: 1,
            type: TypeChatEnum.GRUPE,
            isBan: false,
            memberPermissions: { ...DEFAULT_MEMBER_PERMISSIONS },
        };
        stored = null;
        tableHasRow = false;
        targetRole = RoleChatEnum.USER;
        callerRows = [{ id: 100, role: { name: RoleChatEnum.MANAGER } }];
        grants = [];
        target = {
            id: TARGET_MEMBER_ID,
            user: { id: TARGET_USER_ID },
            role: { name: RoleChatEnum.USER },
        };

        const chatQuery = {
            where: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn(() => chat),
        };
        interface MemberQuery {
            innerJoinAndSelect: jest.Mock;
            where: jest.Mock;
            andWhere: jest.Mock;
            setLock: jest.Mock;
            getOne: jest.Mock;
            getMany: jest.Mock;
        }
        const memberQuery = (): MemberQuery => {
            let userId: unknown = null;
            const query: MemberQuery = {
                innerJoinAndSelect: jest.fn(() => query),
                where: jest.fn(() => query),
                andWhere: jest.fn(
                    (_column: string, params: { userId?: unknown }) => {
                        userId = params.userId;
                        return query;
                    },
                ),
                setLock: jest.fn(() => query),
                getOne: jest.fn(() => ({
                    ...target,
                    user: { id: TARGET_USER_ID },
                })),
                getMany: jest.fn(() => {
                    if (Number(userId) === Number(CALLER_ID)) {
                        return callerRows;
                    }
                    return [{ ...target, role: { name: targetRole } }];
                }),
            };
            return query;
        };

        repositoryInsert = jest.fn(
            (value: { overrides: StoredMemberPermissionOverrides }) => {
                stored = value.overrides;
                tableHasRow = true;
            },
        );
        repositoryUpdate = jest.fn(
            (
                _id: number,
                value: { overrides: StoredMemberPermissionOverrides },
            ) => {
                stored = value.overrides;
                tableHasRow = true;
            },
        );
        repositoryDelete = jest.fn(() => {
            stored = null;
            tableHasRow = false;
        });

        const overrideRepository = {
            findOne: jest.fn(() =>
                tableHasRow ? { id: 1, overrides: stored ?? {} } : null,
            ),
            insert: repositoryInsert,
            update: repositoryUpdate,
            delete: repositoryDelete,
        };

        const manager = {
            getRepository: (entity: unknown) => {
                if (entity === Chat) {
                    return { createQueryBuilder: () => chatQuery };
                }
                if (entity === ChatMember) {
                    return { createQueryBuilder: () => memberQuery() };
                }
                if (entity === MemberPermissionOverride) {
                    return overrideRepository;
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
            getCallerContext: jest.fn(() =>
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            ),
            assertGroup: jest.fn(),
        };
        resolver = {
            getOverrides: jest.fn(() =>
                Promise.resolve(
                    normalizeMemberPermissionOverrides(stored ?? {}),
                ),
            ),
        };
        realtime = { memberPermissionOverridesChanged: jest.fn() };
        rateLimit = { consume: jest.fn(() => Promise.resolve(1)) };
        service = new MemberPermissionOverridesService(
            {
                findOne: jest.fn(() => ({ ...target })),
            } as never,
            { transaction } as never,
            permissions as never,
            resolver as never,
            realtime as never,
            rateLimit as never,
        );
    });

    describe('getForMember', () => {
        it('returns inherit for an unset member with the group default effective', async () => {
            const result = await service.getForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
            );
            expect(result.overrides).toEqual(
                normalizeMemberPermissionOverrides({}),
            );
            expect(result.effective).toEqual({ ...DEFAULT_MEMBER_PERMISSIONS });
            expect(result.canEdit).toBe(true);
        });

        it('lets a regular member read but not edit', async () => {
            permissions.getCallerContext.mockResolvedValue(callerFor());
            await expect(
                service.getForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID),
            ).resolves.toMatchObject({ canEdit: false });
        });

        it('rejects a target admin or owner', async () => {
            targetRole = RoleChatEnum.ADMIN;
            target.role = { name: RoleChatEnum.ADMIN };
            await expect(
                service.getForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID),
            ).rejects.toBeInstanceOf(ConflictException);
        });
    });

    describe('updateForMember', () => {
        it('rejects a regular member before any transaction', async () => {
            permissions.getCallerContext.mockResolvedValue(callerFor());
            await expect(
                service.updateForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID, {
                    send_files: 'deny',
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(transaction).not.toHaveBeenCalled();
        });

        it('rejects unknown keys, bad states and empty patches with 400', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            await expect(
                service.updateForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID, {
                    nope: 'allow',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.updateForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID, {
                    send_files: true,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.updateForMember(
                    CHAT_ID,
                    TARGET_MEMBER_ID,
                    CALLER_ID,
                    {},
                ),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('deny overrides an enabled group default', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            const result = await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { send_files: 'deny' },
            );
            expect(result.changed).toBe(true);
            expect(result.effective.send_files).toBe(false);
            expect(result.overrides.send_files).toBe('deny');
            expect(result.overrides.send_messages).toBe('inherit');
            expect(repositoryInsert).toHaveBeenCalledWith({
                chat: { id: 1 },
                user: { id: TARGET_USER_ID },
                overrides: { send_files: 'deny' },
            });
            expect(
                realtime.memberPermissionOverridesChanged,
            ).toHaveBeenCalledWith(
                1,
                TARGET_USER_ID,
                expect.objectContaining({ send_files: 'deny' }),
                expect.objectContaining({ send_files: false }),
            );
        });

        it('allow overrides a disabled group default', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            const result = await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { add_members: 'allow' },
            );
            expect(result.effective.add_members).toBe(true);
            expect(result.overrides.add_members).toBe('allow');
        });

        it('inherit resets one key and deletes the row when empty', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { send_files: 'deny' },
            );
            const result = await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { send_files: 'inherit' },
            );
            expect(result.overrides.send_files).toBe('inherit');
            expect(result.effective.send_files).toBe(true);
            expect(result.changed).toBe(true);
            expect(repositoryDelete).toHaveBeenCalled();
            expect(stored).toBeNull();
        });

        it('merges two patches field-wise and stores no inherit keys', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { send_links: 'deny' },
            );
            const result = await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { pin_messages: 'allow' },
            );
            expect(result.overrides.send_links).toBe('deny');
            expect(result.overrides.pin_messages).toBe('allow');
            expect(stored).toEqual({
                send_links: 'deny',
                pin_messages: 'allow',
            });
        });

        it('is idempotent: an unchanged state writes and broadcasts nothing', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            const first = await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { send_files: 'deny' },
            );
            expect(first.changed).toBe(true);
            realtime.memberPermissionOverridesChanged.mockClear();
            const second = await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { send_files: 'deny' },
            );
            expect(second.changed).toBe(false);
            expect(repositoryUpdate).not.toHaveBeenCalled();
            expect(
                realtime.memberPermissionOverridesChanged,
            ).not.toHaveBeenCalled();
        });

        it('lets an admin with manage_permissions update and re-checks the grant under lock', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({
                    isAdmin: true,
                    role: RoleChatEnum.ADMIN,
                    permissions: ['manage_permissions'],
                }),
            );
            callerRows = [{ id: 100, role: { name: RoleChatEnum.ADMIN } }];
            grants = [{ permission: { name: 'manage_permissions' } }];
            await expect(
                service.updateForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID, {
                    send_files: 'deny',
                }),
            ).resolves.toMatchObject({ changed: true });

            grants = [];
            stored = null;
            tableHasRow = false;
            await expect(
                service.updateForMember(CHAT_ID, TARGET_MEMBER_ID, CALLER_ID, {
                    send_files: 'allow',
                }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('resetForMember', () => {
        it('deletes the row and restores every group default', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            await service.updateForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
                { add_members: 'allow', send_files: 'deny' },
            );
            const result = await service.resetForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
            );
            expect(result.changed).toBe(true);
            expect(result.overrides).toEqual(
                normalizeMemberPermissionOverrides({}),
            );
            expect(result.effective).toEqual({ ...DEFAULT_MEMBER_PERMISSIONS });
            expect(stored).toBeNull();
        });

        it('is a no-op when the member has no overrides', async () => {
            permissions.getCallerContext.mockResolvedValue(
                callerFor({ isOwner: true, role: RoleChatEnum.MANAGER }),
            );
            const result = await service.resetForMember(
                CHAT_ID,
                TARGET_MEMBER_ID,
                CALLER_ID,
            );
            expect(result.changed).toBe(false);
            expect(
                realtime.memberPermissionOverridesChanged,
            ).not.toHaveBeenCalled();
        });
    });
});
