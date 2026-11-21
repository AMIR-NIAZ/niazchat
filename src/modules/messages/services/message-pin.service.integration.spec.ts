import 'dotenv/config';
import { WsException } from '@nestjs/websockets';
import { DataSource, Repository } from 'typeorm';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import { PermissionAdmin } from 'src/modules/chats/entities/permission_admin.entity';
import { PermissionChat } from 'src/modules/chats/entities/permission_chat.entity';
import { Link } from 'src/modules/chats/entities/link.entity';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { UserProfile } from 'src/modules/auth/entities/user_profile.entity';
import { Role } from 'src/modules/auth/entities/role.entity';
import { Permission } from 'src/modules/auth/entities/permission.entity';
import { UserPermission } from 'src/modules/auth/entities/user_permissions.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { Message } from '../entities/message.entity';
import { TypeMessage } from '../entities/typeMessage.entity';
import { MessageService } from './message.service';

/**
 * Real-PostgreSQL coverage for the pin transaction. TypeORM emits LEFT JOINs
 * for relation filters/relations, and PostgreSQL rejects `FOR UPDATE` on the
 * nullable side of an outer join. This spec exercises the real queries, so a
 * regression to "lock a query with relations" fails here instead of only in
 * production.
 *
 * Opt-in and fully isolated: it creates a throwaway database from the `.env`
 * connection settings, lets TypeORM build the schema there (`synchronize`),
 * seeds a minimal fixture and DROPS the database afterwards. The development
 * database is never modified.
 *
 *     TEST_DB=true npx jest message-pin.service.integration
 */

const enabled = process.env.TEST_DB === 'true';
const entities = [
    Chat,
    ChatMember,
    ChatSeen,
    RoleChat,
    PermissionAdmin,
    PermissionChat,
    Link,
    Message,
    TypeMessage,
    Attachment,
    User,
    UserProfile,
    Role,
    Permission,
    UserPermission,
];

function connectionOptions(database: string) {
    return {
        type: 'postgres' as const,
        host: String(process.env.HOST_DB ?? 'localhost'),
        port: Number(process.env.PORT_DB ?? 5432),
        username: String(process.env.USERNAME_DB ?? ''),
        password: String(process.env.PASSWORD_DB ?? ''),
        database,
    };
}

(enabled ? describe : describe.skip)(
    'MessageService pinning against PostgreSQL',
    () => {
        let dataSource: DataSource;
        let admin: DataSource;
        let service: MessageService;
        let messageRepository: Repository<Message>;
        let users: User[] = [];
        let userRole: RoleChat;
        let textType: TypeMessage;
        let systemType: TypeMessage;
        let access: { getCallerContext: jest.Mock };
        const databaseName = `niazchat_pin_test_${process.pid}_${Date.now()}`;

        function caller(
            chat: Chat,
            over: {
                roleName?: RoleChatEnum;
                permissions?: PermissionChatEnum[];
                isManager?: boolean;
                isAdmin?: boolean;
                isBan?: boolean;
                member?: boolean;
            } = {},
        ) {
            return {
                chat: {
                    id: chat.id,
                    type: chat.type,
                    isBan: over.isBan ?? false,
                },
                member: over.member === false ? null : { id: 1 },
                roleName: over.roleName ?? RoleChatEnum.USER,
                permissions: over.permissions ?? [],
                isManager: over.isManager ?? false,
                isAdmin: over.isAdmin ?? false,
            };
        }

        async function createChat(
            type: TypeChatEnum,
            memberIds: number[],
            role: RoleChat = userRole,
        ): Promise<Chat> {
            const chat = await dataSource.getRepository(Chat).save({
                type,
                avatars: [],
                isBan: false,
                ...(type === TypeChatEnum.PRIVATE
                    ? {
                          pairKey: `pin-test:${Math.random().toString(36).slice(2)}`,
                      }
                    : {}),
            });
            await dataSource.getRepository(ChatMember).insert(
                memberIds.map((id) => ({
                    chat: { id: chat.id },
                    user: { id },
                    role: { id: role.id },
                })),
            );
            return chat;
        }

        async function addMessage(
            chat: Chat,
            sender: User,
            type: TypeMessage = textType,
            content = 'pin me',
        ): Promise<Message> {
            return dataSource.getRepository(Message).save({
                chat: { id: chat.id },
                sender: { id: sender.id },
                content,
                type: { id: type.id },
            });
        }

        beforeAll(async () => {
            admin = new DataSource(
                connectionOptions(String(process.env.DATABASE_DB ?? '')),
            );
            await admin.initialize();
            await admin.query(`CREATE DATABASE "${databaseName}"`);
            dataSource = new DataSource({
                ...connectionOptions(databaseName),
                synchronize: true,
                entities,
            });
            await dataSource.initialize();

            const usersRepository = dataSource.getRepository(User);
            users = await usersRepository.save(
                ['A', 'B'].map((_label, index) =>
                    usersRepository.create({
                        phone: `+1999001${index}${Date.now()}`.slice(0, 16),
                        status: UserStatusEnum.ACTIVE,
                    }),
                ),
            );

            userRole = await dataSource.getRepository(RoleChat).save({
                name: RoleChatEnum.USER,
            });
            await dataSource.getRepository(RoleChat).save({
                name: RoleChatEnum.BAN,
            });
            textType = await dataSource
                .getRepository(TypeMessage)
                .save({ name: 'text' });
            systemType = await dataSource
                .getRepository(TypeMessage)
                .save({ name: 'system' });

            messageRepository = dataSource.getRepository(Message);
            access = { getCallerContext: jest.fn() };

            service = new MessageService(
                messageRepository,
                dataSource.getRepository(ChatMember),
                dataSource.getRepository(User),
                dataSource.getRepository(TypeMessage),
                dataSource,
                {} as never,
                {} as never,
                access as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
                {} as never,
            );
        }, 120_000);

        afterAll(async () => {
            if (dataSource?.isInitialized) {
                await dataSource.destroy();
            }
            if (admin?.isInitialized) {
                await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
                await admin.destroy();
            }
        }, 120_000);

        beforeEach(() => {
            access.getCallerContext.mockReset();
        });

        it('pins and unpins a private-chat message', async () => {
            const chat = await createChat(TypeChatEnum.PRIVATE, [
                users[0].id,
                users[1].id,
            ]);
            const message = await addMessage(chat, users[0]);
            access.getCallerContext.mockResolvedValue(
                caller(chat, { roleName: RoleChatEnum.MANAGER }),
            );

            const pinned = await service.pin(
                { chatId: chat.id, messageId: message.id } as never,
                { sub: users[0].id, role: 'user' } as never,
            );
            expect(pinned.changed).toBe(true);
            expect(pinned.message.isPinned).toBe(true);
            expect(pinned.message.pinnedAt).toBeInstanceOf(Date);

            const stored = await messageRepository.findOneByOrFail({
                id: message.id,
            });
            expect(stored.isPinned).toBe(true);
            expect(stored.pinnedAt).toBeInstanceOf(Date);

            const unpinned = await service.unpin(
                { chatId: chat.id, messageId: message.id } as never,
                { sub: users[0].id, role: 'user' } as never,
            );
            expect(unpinned).toEqual({ messageId: message.id, changed: true });
            const afterUnpin = await messageRepository.findOneByOrFail({
                id: message.id,
            });
            expect(afterUnpin.isPinned).toBe(false);
            expect(afterUnpin.pinnedAt).toBeNull();
        });

        it('pins a group message for the owner and for a granted member', async () => {
            const chat = await createChat(TypeChatEnum.GRUPE, [users[0].id]);
            const message = await addMessage(chat, users[0]);

            access.getCallerContext.mockResolvedValue(
                caller(chat, {
                    roleName: RoleChatEnum.MANAGER,
                    isManager: true,
                }),
            );
            await expect(
                service.pin(
                    { chatId: chat.id, messageId: message.id } as never,
                    { sub: users[0].id, role: 'user' } as never,
                ),
            ).resolves.toMatchObject({ changed: true });
            await service.unpin(
                { chatId: chat.id, messageId: message.id } as never,
                { sub: users[0].id, role: 'user' } as never,
            );

            access.getCallerContext.mockResolvedValue(
                caller(chat, { permissions: [PermissionChatEnum.PIN_MESSAGE] }),
            );
            await expect(
                service.pin(
                    { chatId: chat.id, messageId: message.id } as never,
                    { sub: users[1].id, role: 'user' } as never,
                ),
            ).resolves.toMatchObject({ changed: true });
            const stored = await messageRepository.findOneByOrFail({
                id: message.id,
            });
            expect(stored.isPinned).toBe(true);
        });

        it('rejects unauthorized and cross-chat pin attempts without writing', async () => {
            const chat = await createChat(TypeChatEnum.GRUPE, [users[0].id]);
            const otherChat = await createChat(TypeChatEnum.GRUPE, [
                users[0].id,
            ]);
            const message = await addMessage(otherChat, users[0]);

            access.getCallerContext.mockResolvedValue(caller(chat));
            await expect(
                service.pin(
                    { chatId: chat.id, messageId: message.id } as never,
                    { sub: users[1].id, role: 'user' } as never,
                ),
            ).rejects.toBeInstanceOf(WsException);

            access.getCallerContext.mockResolvedValue(
                caller(otherChat, {
                    permissions: [PermissionChatEnum.PIN_MESSAGE],
                }),
            );
            await expect(
                service.pin(
                    { chatId: chat.id, messageId: message.id } as never,
                    { sub: users[1].id, role: 'user' } as never,
                ),
            ).rejects.toThrow('message not found');

            const stored = await messageRepository.findOneByOrFail({
                id: message.id,
            });
            expect(stored.isPinned).toBe(false);
        });

        it('rejects deleted and system messages', async () => {
            const chat = await createChat(TypeChatEnum.GRUPE, [users[0].id]);
            const deleted = await addMessage(chat, users[0]);
            await messageRepository.update(deleted.id, { isDeleted: true });
            const system = await addMessage(
                chat,
                users[0],
                systemType,
                'member joined',
            );
            access.getCallerContext.mockResolvedValue(
                caller(chat, {
                    roleName: RoleChatEnum.MANAGER,
                    isManager: true,
                }),
            );

            await expect(
                service.pin(
                    { chatId: chat.id, messageId: deleted.id } as never,
                    { sub: users[0].id, role: 'user' } as never,
                ),
            ).rejects.toThrow('message not found');
            await expect(
                service.pin(
                    { chatId: chat.id, messageId: system.id } as never,
                    { sub: users[0].id, role: 'user' } as never,
                ),
            ).rejects.toThrow('system messages cannot be pinned');
        });

        it('serializes concurrent pin requests: one write, no duplicate state', async () => {
            const chat = await createChat(TypeChatEnum.PRIVATE, [
                users[0].id,
                users[1].id,
            ]);
            const message = await addMessage(chat, users[0]);
            access.getCallerContext.mockResolvedValue(
                caller(chat, { roleName: RoleChatEnum.MANAGER }),
            );

            const user = { sub: users[0].id, role: 'user' } as never;
            const results = await Promise.all([
                service.pin(
                    { chatId: chat.id, messageId: message.id } as never,
                    user,
                ),
                service.pin(
                    { chatId: chat.id, messageId: message.id } as never,
                    user,
                ),
            ]);

            expect(results.filter((result) => result.changed)).toHaveLength(1);
            const stored = await messageRepository.findOneByOrFail({
                id: message.id,
            });
            expect(stored.isPinned).toBe(true);

            const unpins = await Promise.all([
                service.unpin(
                    { chatId: chat.id, messageId: message.id } as never,
                    user,
                ),
                service.unpin(
                    { chatId: chat.id, messageId: message.id } as never,
                    user,
                ),
            ]);
            expect(unpins.filter((result) => result.changed)).toHaveLength(1);
            expect(
                (await messageRepository.findOneByOrFail({ id: message.id }))
                    .isPinned,
            ).toBe(false);
        });
    },
);
