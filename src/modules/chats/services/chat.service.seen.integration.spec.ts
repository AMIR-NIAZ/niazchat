import 'dotenv/config';
import { DataSource, Repository } from 'typeorm';
import { ChatService } from './chat.service';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { ChatSeen } from '../entities/chats_seen.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { PermissionChat } from '../entities/permission_chat.entity';
import { Link } from '../entities/link.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import { TypeMessage } from 'src/modules/messages/entities/typeMessage.entity';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { UserProfile } from 'src/modules/auth/entities/user_profile.entity';
import { Role } from 'src/modules/auth/entities/role.entity';
import { Permission } from 'src/modules/auth/entities/permission.entity';
import { UserPermission } from 'src/modules/auth/entities/user_permissions.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import type { UserId } from 'src/common/types/brands.type';

/**
 * Real-PostgreSQL coverage for the read receipt that a message needs before a
 * sender can see "Seen": the row `markSeen` writes, the unread count it clears,
 * and the `othersLastSeenId` the sender's chat-info carries.
 *
 * Opt-in, and fully isolated: it creates a throwaway database from the `.env`
 * connection settings, lets TypeORM build the schema there (`synchronize`),
 * seeds a minimal fixture and DROPS the database afterwards. The development
 * database is never modified.
 *
 *     TEST_DB=true npx jest chat.service.seen.integration
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
    'ChatService.markSeen against PostgreSQL',
    () => {
        let dataSource: DataSource;
        let admin: DataSource;
        let service: ChatService;
        let seenRepository: Repository<ChatSeen>;
        let messageRepository: Repository<Message>;
        let users: User[] = [];
        let userRole: RoleChat;
        let messageType: TypeMessage;
        const databaseName = `niazchat_seen_test_${process.pid}_${Date.now()}`;

        async function createChat(
            type: TypeChatEnum,
            memberIds: number[],
        ): Promise<Chat> {
            const chat = await dataSource.getRepository(Chat).save({
                type,
                avatars: [],
                isBan: false,
                ...(type === TypeChatEnum.PRIVATE
                    ? { pairKey: `test:${Math.random().toString(36).slice(2)}` }
                    : {}),
            });
            await dataSource.getRepository(ChatMember).insert(
                memberIds.map((id) => ({
                    chat: { id: chat.id },
                    user: { id },
                    role: { id: userRole.id },
                })),
            );
            return chat;
        }

        async function addMessage(
            chat: Chat,
            sender: User,
            content: string,
        ): Promise<Message> {
            return dataSource.getRepository(Message).save({
                chat: { id: chat.id },
                sender: { id: sender.id },
                content,
                type: { id: messageType.id },
            });
        }

        beforeAll(async () => {
            admin = new DataSource(
                connectionOptions(String(process.env.DATABASE_DB ?? '')),
            );
            await admin.initialize();
            // A dedicated, disposable database: synchronize may reshape freely.
            await admin.query(`CREATE DATABASE "${databaseName}"`);
            dataSource = new DataSource({
                ...connectionOptions(databaseName),
                synchronize: true,
                entities,
            });
            await dataSource.initialize();

            const usersRepository = dataSource.getRepository(User);
            users = await usersRepository.save(
                ['A', 'B', 'C'].map((label, index) =>
                    usersRepository.create({
                        phone: `+1999000${index}${Date.now()}`.slice(0, 16),
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
            messageType = await dataSource.getRepository(TypeMessage).save({
                name: 'text',
            });

            seenRepository = dataSource.getRepository(ChatSeen);
            messageRepository = dataSource.getRepository(Message);

            // `access`/`groupRealtime` are not touched by the read-receipt path.
            service = new ChatService(
                dataSource.getRepository(Chat) as never,
                dataSource.getRepository(ChatMember) as never,
                seenRepository as never,
                messageRepository as never,
                dataSource.getRepository(RoleChat) as never,
                usersRepository as never,
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
        });

        it('Test 1 — a private read receipt is persisted and visible to the sender', async () => {
            const [a, b] = users as [User, User];
            const chat = await createChat(TypeChatEnum.PRIVATE, [
                Number(a.id),
                Number(b.id),
            ]);
            const first = await addMessage(chat, a, 'hello');
            const second = await addMessage(chat, a, 'are you there?');

            expect(
                (await service.getUnreadCounts(Number(b.id) as UserId)).get(
                    String(chat.id),
                ),
            ).toBe(2);

            const result = await service.markSeen(
                chat.id,
                Number(b.id) as UserId,
                Number(second.id),
            );
            expect(result).toEqual({
                lastSeenId: Number(second.id),
                changed: true,
            });

            // Persisted, not just acked.
            const rows = await seenRepository.find({
                where: {
                    chat: { id: chat.id },
                    user: { id: Number(b.id) as UserId },
                },
                relations: { message: true, chat: true, user: true },
            });
            expect(rows).toHaveLength(1);
            expect(Number(rows[0]?.message?.id)).toBe(Number(second.id));

            // The sender's ticks read `othersLastSeenId` from chat info.
            const senderState = await service.getChatSeenState(
                chat.id,
                Number(a.id) as UserId,
            );
            expect(senderState.othersLastSeenId).toBe(Number(second.id));
            // getUnreadCounts omits chats with zero unread (callers use ?? 0).
            expect(
                (await service.getUnreadCounts(Number(b.id) as UserId)).get(
                    String(chat.id),
                ) ?? 0,
            ).toBe(0);
            expect(Number(first.id)).toBeLessThan(Number(second.id));

            // A second markSeen for the same position is a no-op (the gateway
            // relies on `changed` to avoid duplicate `seen` broadcasts).
            expect(
                await service.markSeen(
                    chat.id,
                    Number(b.id) as UserId,
                    Number(second.id),
                ),
            ).toEqual({ lastSeenId: Number(second.id), changed: false });
        });

        it('Test 2/3 — read positions are per chat: reading one private chat does not touch another', async () => {
            const [a, b, c] = users as [User, User, User];
            const chatOne = await createChat(TypeChatEnum.PRIVATE, [
                Number(a.id),
                Number(b.id),
            ]);
            const chatTwo = await createChat(TypeChatEnum.PRIVATE, [
                Number(b.id),
                Number(c.id),
            ]);
            const oneMessage = await addMessage(chatOne, a, 'from A');
            await addMessage(chatTwo, c, 'from C');
            const twoLatest = await addMessage(chatTwo, c, 'from C again');

            await service.markSeen(
                chatOne.id,
                Number(b.id) as UserId,
                Number(oneMessage.id),
            );
            // The message belongs to another chat, so it can never clear chat
            // two (the backend rejects a cross-chat id).
            await expect(
                service.markSeen(
                    chatTwo.id,
                    Number(b.id) as UserId,
                    Number(oneMessage.id),
                ),
            ).rejects.toThrow('seen message not found in this chat');

            expect(
                (
                    await service.getChatSeenState(
                        chatTwo.id,
                        Number(c.id) as UserId,
                    )
                ).othersLastSeenId,
            ).toBeNull();

            await service.markSeen(
                chatTwo.id,
                Number(b.id) as UserId,
                Number(twoLatest.id),
            );
            expect(
                (await service.getUnreadCounts(Number(b.id) as UserId)).get(
                    String(chatTwo.id),
                ) ?? 0,
            ).toBe(0);
            expect(
                (await service.getUnreadCounts(Number(b.id) as UserId)).get(
                    String(chatOne.id),
                ) ?? 0,
            ).toBe(0);
        });

        it('Test 5 — many incoming messages are covered by one advancing receipt', async () => {
            const [a, b] = users as [User, User];
            const chat = await createChat(TypeChatEnum.PRIVATE, [
                Number(a.id),
                Number(b.id),
            ]);
            const sent: Message[] = [];
            for (let index = 0; index < 5; index += 1) {
                sent.push(await addMessage(chat, a, `burst ${index}`));
            }
            const newest = sent[sent.length - 1];

            const result = await service.markSeen(
                chat.id,
                Number(b.id) as UserId,
                Number(newest.id),
            );
            expect(result.changed).toBe(true);
            expect(
                (await service.getUnreadCounts(Number(b.id) as UserId)).get(
                    String(chat.id),
                ) ?? 0,
            ).toBe(0);
            expect(
                await seenRepository.count({
                    where: {
                        chat: { id: chat.id },
                        user: { id: Number(b.id) as UserId },
                    },
                }),
            ).toBe(1);
        });

        it('Test 6 — group receipts keep working the same way', async () => {
            const [a, b, c] = users as [User, User, User];
            const group = await createChat(TypeChatEnum.GRUPE, [
                Number(a.id),
                Number(b.id),
                Number(c.id),
            ]);
            const message = await addMessage(group, a, 'group hello');
            const result = await service.markSeen(
                group.id,
                Number(b.id) as UserId,
                Number(message.id),
            );
            expect(result).toEqual({
                lastSeenId: Number(message.id),
                changed: true,
            });
            expect(
                (
                    await service.getChatSeenState(
                        group.id,
                        Number(a.id) as UserId,
                    )
                ).othersLastSeenId,
            ).toBe(Number(message.id));
            expect(
                (await service.getUnreadCounts(Number(b.id) as UserId)).get(
                    String(group.id),
                ) ?? 0,
            ).toBe(0);
            // C has not read it: B's receipt says nothing about C.
            expect(
                (await service.getUnreadCounts(Number(c.id) as UserId)).get(
                    String(group.id),
                ),
            ).toBe(1);
        });

        it('Test 7 — an empty chat never throws and never writes a row', async () => {
            const [a, b] = users as [User, User];
            const chat = await createChat(TypeChatEnum.PRIVATE, [
                Number(a.id),
                Number(b.id),
            ]);
            expect(
                await service.markSeen(chat.id, Number(b.id) as UserId, 1),
            ).toEqual({ lastSeenId: 0, changed: false });
            expect(
                await seenRepository.count({
                    where: { chat: { id: chat.id } },
                }),
            ).toBe(0);
            expect(
                await messageRepository.count({
                    where: { chat: { id: chat.id } },
                }),
            ).toBe(0);
        });
    },
);
