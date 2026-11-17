import { Logger } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager, In } from 'typeorm';
import { Seeder } from '../seeder.base';
import { RoleEnum } from 'src/common/enums/role.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { User } from 'src/modules/auth/entities/user.entity';
import { UserProfile } from 'src/modules/auth/entities/user_profile.entity';
import { Role } from 'src/modules/auth/entities/role.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { PermissionChat } from 'src/modules/chats/entities/permission_chat.entity';
import { PermissionAdmin } from 'src/modules/chats/entities/permission_admin.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import { TypeMessage } from 'src/modules/messages/entities/typeMessage.entity';
import { serviceMessageContent } from 'src/modules/chats/utils/service-message.util';
import type { ServiceMessageMeta } from 'src/modules/messages/service-message.types';
import { MessageReact } from 'src/modules/reactions/entities/message_react.entity';
import { React } from 'src/modules/reactions/entities/react.entity';
import {
    DEMO_GROUPS,
    DEMO_USERS,
    LONG_PERSIAN_MESSAGES,
    MULTILINE_PERSIAN_MESSAGES,
    PERSIAN_MESSAGES,
    type DemoGroupSeed,
    type DemoUserSeed,
} from './data/persian-messages';

export interface DemoSeedOptions {
    /** Username or phone of an existing user who joins every demo group. */
    me: string;
    /** Only used for the summary; auth in this project is phone-OTP based. */
    password: string;
    /** Delete demo data (identified by `demo_*` usernames / `[دمو]` titles) first. */
    reset: boolean;
}

export interface DemoSeedSummary {
    me: { id: number; name: string; username: string; phone: string };
    users: { created: number; existing: number };
    groups: { created: number; existing: number };
    members: number;
    messages: number;
    serviceMessages: number;
    deleted: {
        users: number;
        chats: number;
        messages: number;
    };
    unread: Array<{ title: string; unread: number }>;
    password: string;
}

interface ResolvedDemoUser {
    id: number;
    name: string;
    username: string;
    phone: string;
    seed: DemoUserSeed;
}

interface MeUser {
    id: number;
    name: string;
    username: string;
    phone: string;
}

interface GroupMember {
    id: number;
    name: string;
    username: string;
    role: RoleChatEnum;
    permission?: PermissionChatEnum;
}

type MessageSpec =
    | {
          kind: 'text';
          at: Date;
          senderId: number;
          content: string;
          isEdited: boolean;
          replyToIndex: number | null;
      }
    | {
          kind: 'system';
          at: Date;
          senderId: number;
          content: string;
          meta: ServiceMessageMeta;
      };

const MESSAGE_INSERT_BATCH = 200;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Deterministic PRNG (mulberry32): reruns produce identical demo data. */
function rngFor(seed: number): () => number {
    let state = seed >>> 0;
    return (): number => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function seedFor(text: string): number {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function pick<T>(rng: () => number, values: readonly T[]): T {
    return values[Math.floor(rng() * values.length)];
}

/**
 * Development-only demo data.
 *
 * Deliberately NOT registered in `SeederService`'s SEEDERS list: it must never
 * run automatically on boot or via `run-all`. It is only reachable through
 * `npm run seed:demo` (`demo-seed.ts`), which refuses to run in production.
 */
export class DemoSeeder extends Seeder {
    private readonly logger = new Logger(DemoSeeder.name);
    private result: DemoSeedSummary | null = null;

    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    get summary(): DemoSeedSummary {
        if (this.result === null) {
            throw new Error('DemoSeeder has not run yet');
        }
        return this.result;
    }

    async run(options: DemoSeedOptions): Promise<void> {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(
                'Refusing to seed demo data: NODE_ENV=production. This seeder is development-only.',
            );
        }
        if (!options.me || options.me.trim() === '') {
            throw new Error(
                'SEED_ME is required: set it to an existing username or phone number.',
            );
        }

        const me = await this.resolveMe(options.me.trim());
        this.logger.log(
            `Demo target account: ${me.name} (@${me.username}, ${me.phone}, id=${me.id})`,
        );

        const deleted = options.reset
            ? await this.resetDemoData(me.id)
            : { users: 0, chats: 0, messages: 0 };
        if (options.reset) {
            this.logger.log(
                `Reset: removed ${deleted.users} demo users, ${deleted.chats} demo groups, ${deleted.messages} messages.`,
            );
        }

        const roles = await this.loadReferenceData();
        const { users, created } = await this.ensureDemoUsers(roles.userRole);
        const textType = await this.dataSource
            .getRepository(TypeMessage)
            .findOne({ where: { name: TypeMessageEnum.TEXT } });
        if (!textType) {
            throw new Error(
                "Message type 'text' is missing. Run `npm run seed:run-all` first.",
            );
        }
        const systemType = await this.dataSource
            .getRepository(TypeMessage)
            .findOne({ where: { name: TypeMessageEnum.SYSTEM } });
        if (systemType === null) {
            this.logger.warn(
                "Message type 'system' is missing: skipping service messages (run `npm run seed:run-all` to enable them).",
            );
        }

        const byUsername = new Map(
            users.map((user) => [user.username, user] as const),
        );
        const unread: DemoSeedSummary['unread'] = [];
        let members = 0;
        let messages = 0;
        let serviceMessages = 0;
        let createdGroups = 0;
        let existingGroups = 0;

        for (let index = 0; index < DEMO_GROUPS.length; index += 1) {
            const group = DEMO_GROUPS[index];
            const outcome = await this.seedGroup({
                group,
                index,
                me,
                users: byUsername,
                roles: roles.roles,
                textTypeId: Number(textType.id),
                systemTypeId:
                    systemType === null ? null : Number(systemType.id),
            });
            if (outcome.created) {
                createdGroups += 1;
                members += outcome.members;
                messages += outcome.messages;
                serviceMessages += outcome.serviceMessages;
            } else {
                existingGroups += 1;
            }
            unread.push({ title: group.title, unread: outcome.unreadForMe });
        }

        this.result = {
            me,
            users: { created, existing: users.length - created },
            groups: { created: createdGroups, existing: existingGroups },
            members,
            messages,
            serviceMessages,
            deleted,
            unread,
            password: options.password,
        };
    }

    // ------------------------------------------------------------------ users

    private async resolveMe(identifier: string): Promise<MeUser> {
        const profileRepository = this.dataSource.getRepository(UserProfile);
        const profile = await profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('LOWER(profile.username) = LOWER(:identifier)', {
                identifier,
            })
            .getOne();

        if (profile?.user) {
            return {
                id: Number(profile.user.id),
                name: profile.name?.trim() || profile.username || identifier,
                username: profile.username ?? '',
                phone: profile.user.phone,
            };
        }

        const phones = phoneVariants(identifier);
        if (phones.length > 0) {
            const user = await this.dataSource
                .getRepository(User)
                .createQueryBuilder('user')
                .leftJoinAndSelect('user.profile', 'profile')
                .where('user.phone IN (:...phones)', { phones })
                .getOne();
            if (user) {
                return {
                    id: Number(user.id),
                    name:
                        user.profile?.name?.trim() ||
                        user.profile?.username ||
                        user.phone,
                    username: user.profile?.username ?? '',
                    phone: user.phone,
                };
            }
        }

        throw new Error(
            `SEED_ME='${identifier}' was not found. Pass an existing username (user_profiles.username) or phone (users.phone), e.g. SEED_ME=demo_ali or SEED_ME=+989120000001.`,
        );
    }

    private async ensureDemoUsers(
        userRole: Role,
    ): Promise<{ users: ResolvedDemoUser[]; created: number }> {
        const result: ResolvedDemoUser[] = [];
        let created = 0;

        await this.dataSource.transaction(async (manager) => {
            for (const seed of DEMO_USERS) {
                let profile = await manager.findOne(UserProfile, {
                    where: { username: seed.username },
                    relations: { user: true },
                });
                let user = profile?.user ?? null;

                if (!user) {
                    user = await manager.findOne(User, {
                        where: { phone: seed.phone },
                        relations: { profile: true },
                    });
                    profile = user?.profile ?? null;
                }

                if (!user) {
                    user = await manager.save(
                        manager.create(User, {
                            phone: seed.phone,
                            role: userRole,
                        }),
                    );
                    profile = await manager.save(
                        manager.create(UserProfile, {
                            user,
                            name: seed.name,
                            username: seed.username,
                        }),
                    );
                    created += 1;
                } else {
                    if (!user.role) {
                        user.role = userRole;
                        await manager.save(user);
                    }
                    if (!profile) {
                        profile = await manager.save(
                            manager.create(UserProfile, {
                                user,
                                name: seed.name,
                                username: seed.username,
                            }),
                        );
                    } else if (
                        !profile.name ||
                        profile.username !== seed.username
                    ) {
                        profile.name = profile.name || seed.name;
                        if (!profile.username) {
                            profile.username = seed.username;
                        }
                        await manager.save(profile);
                    }
                }

                result.push({
                    id: Number(user.id),
                    name: profile?.name?.trim() || seed.name,
                    username: profile?.username ?? seed.username,
                    phone: user.phone,
                    seed,
                });
            }
        });

        if (created > 0) {
            this.logger.log(
                `Created ${created} demo users (total seeded: ${DEMO_USERS.length}).`,
            );
        }
        return { users: result, created };
    }

    private async loadReferenceData(): Promise<{
        userRole: Role;
        roles: Record<RoleChatEnum, RoleChat>;
        permissions: Record<PermissionChatEnum, PermissionChat>;
    }> {
        const userRole = await this.dataSource
            .getRepository(Role)
            .findOne({ where: { name: RoleEnum.USER } });
        if (!userRole) {
            throw new Error(
                "Role 'user' is missing. Run `npm run seed:run-all` first.",
            );
        }

        const roleRows = await this.dataSource.getRepository(RoleChat).find();
        const roleByName = new Map(
            roleRows.map((role) => [role.name, role] as const),
        );
        const requiredRoles = [
            RoleChatEnum.MANAGER,
            RoleChatEnum.ADMIN,
            RoleChatEnum.USER,
            RoleChatEnum.BAN,
        ] as const;
        for (const name of requiredRoles) {
            if (!roleByName.has(name)) {
                throw new Error(
                    `Chat role '${name}' is missing. Run \`npm run seed:run-all\` first.`,
                );
            }
        }

        const permissionRows = await this.dataSource
            .getRepository(PermissionChat)
            .find();
        const permissionByName = new Map(
            permissionRows.map(
                (permission) => [permission.name, permission] as const,
            ),
        );
        const requiredPermissions = [
            PermissionChatEnum.ALL,
            PermissionChatEnum.BAN_USER,
            PermissionChatEnum.CHANGE_INFO_CHAT,
            PermissionChatEnum.DELETE_MESSAGE,
        ] as const;
        for (const name of requiredPermissions) {
            if (!permissionByName.has(name)) {
                throw new Error(
                    `Chat permission '${name}' is missing. Run \`npm run seed:run-all\` first.`,
                );
            }
        }

        return {
            userRole,
            roles: {
                [RoleChatEnum.MANAGER]: roleByName.get(RoleChatEnum.MANAGER)!,
                [RoleChatEnum.ADMIN]: roleByName.get(RoleChatEnum.ADMIN)!,
                [RoleChatEnum.USER]: roleByName.get(RoleChatEnum.USER)!,
                [RoleChatEnum.BAN]: roleByName.get(RoleChatEnum.BAN)!,
            },
            permissions: {
                [PermissionChatEnum.ALL]: permissionByName.get(
                    PermissionChatEnum.ALL,
                )!,
                [PermissionChatEnum.BAN_USER]: permissionByName.get(
                    PermissionChatEnum.BAN_USER,
                )!,
                [PermissionChatEnum.CHANGE_INFO_CHAT]: permissionByName.get(
                    PermissionChatEnum.CHANGE_INFO_CHAT,
                )!,
                [PermissionChatEnum.DELETE_MESSAGE]: permissionByName.get(
                    PermissionChatEnum.DELETE_MESSAGE,
                )!,
            },
        };
    }

    // ----------------------------------------------------------------- groups

    private async seedGroup(input: {
        group: DemoGroupSeed;
        index: number;
        me: MeUser;
        users: Map<string, ResolvedDemoUser>;
        roles: Record<RoleChatEnum, RoleChat>;
        textTypeId: number;
        systemTypeId: number | null;
    }): Promise<{
        created: boolean;
        members: number;
        messages: number;
        serviceMessages: number;
        unreadForMe: number;
    }> {
        const { group, index, me, users, roles, textTypeId, systemTypeId } =
            input;
        const existing = await this.dataSource.getRepository(Chat).findOne({
            where: { title: group.title, type: TypeChatEnum.GRUPE },
        });
        if (existing) {
            this.logger.log(`[skip] ${group.title} already exists`);
            return {
                created: false,
                members: 0,
                messages: 0,
                serviceMessages: 0,
                unreadForMe: group.unreadForMe,
            };
        }

        const memberPlan = this.planMembers(group, index, me, users);
        const rng = rngFor(seedFor(`${group.title}:${group.messageCount}`));
        const now = Date.now();
        // Give every group its own window inside the last 14 days (older groups
        // first), so chats do not all share identical timestamps while group
        // `createdAt` stays strictly ordered.
        const timelineEnd = new Date(
            now - (15 + (DEMO_GROUPS.length - 1 - index) * 30) * 60 * 1000,
        );
        const timelineStart = new Date(
            timelineEnd.getTime() - TWO_WEEKS_MS + index * 30 * 60 * 1000,
        );

        const leaver = users.get(group.leaver);
        const specs = this.buildMessageSpecs({
            group,
            index,
            me,
            memberPlan,
            users,
            systemTypeId,
            rng,
            timelineStart,
            timelineEnd,
            leaverName: leaver?.name ?? group.leaver,
        });

        const outcome = await this.dataSource.transaction(async (manager) => {
            const chat = await manager.getRepository(Chat).save({
                title: group.title,
                description: group.description,
                type: TypeChatEnum.GRUPE,
                avatars: [],
                isBan: false,
                pairKey: null,
            });
            const chatId = Number(chat.id);
            const createdAt = new Date(timelineStart.getTime() - 3 * HOUR_MS);

            await manager.query(
                'UPDATE "chats" SET "createdAt" = $2, "updatedAt" = $3 WHERE id = $1',
                [chatId, createdAt, createdAt],
            );

            const memberRows: DeepPartial<ChatMember>[] = memberPlan.map(
                (member) => ({
                    chat: { id: chatId },
                    user: { id: member.id },
                    role: { id: roles[member.role].id },
                }),
            );
            await manager.save(ChatMember, memberRows);

            const savedMembers = await manager.getRepository(ChatMember).find({
                where: { chat: { id: chat.id } },
                relations: { user: true, role: true },
            });
            const memberIdByUser = new Map(
                savedMembers.map(
                    (member) =>
                        [Number(member.user.id), Number(member.id)] as const,
                ),
            );

            const permissionIds = await this.permissionIds();
            const grantRows: DeepPartial<PermissionAdmin>[] = [];
            for (const member of memberPlan) {
                if (member.role !== RoleChatEnum.ADMIN) continue;
                const permissionName =
                    member.permission ??
                    (member.id === me.id
                        ? index % 2 === 0
                            ? PermissionChatEnum.ALL
                            : PermissionChatEnum.CHANGE_INFO_CHAT
                        : null);
                if (!permissionName) continue;
                const memberId = memberIdByUser.get(member.id);
                if (!memberId) continue;
                const permissionId = permissionIds.get(permissionName);
                if (!permissionId) continue;
                grantRows.push({
                    permission: { id: permissionId },
                    member: { id: memberId },
                });
            }
            if (grantRows.length > 0) {
                await manager.save(PermissionAdmin, grantRows);
            }

            const { saved, serviceCount } = await this.insertMessages(
                manager,
                chatId,
                specs,
                textTypeId,
                systemTypeId,
            );

            await this.applyReplyLinks(manager, specs, saved);

            const activeMembers = memberPlan.filter(
                (member) => member.role !== RoleChatEnum.BAN,
            );
            await this.insertReactions(manager, specs, saved, activeMembers);

            const last = saved[saved.length - 1];
            if (!last) {
                throw new Error(`No messages generated for ${group.title}`);
            }
            const lastId = Number(last.id);
            const lastAt =
                specs[specs.length - 1]?.at ?? new Date(now - 15 * 60 * 1000);

            const eligible = specs
                .map((spec, specIndex) => ({ spec, saved: saved[specIndex] }))
                .filter(
                    (row) =>
                        row.saved !== undefined &&
                        row.spec.kind === 'text' &&
                        row.spec.senderId !== me.id,
                )
                .map((row) => Number(row.saved.id));
            const unreadForMe = Math.min(group.unreadForMe, eligible.length);
            const seenId =
                unreadForMe === 0
                    ? lastId
                    : (eligible[eligible.length - unreadForMe - 1] ?? lastId);

            const seenRows: DeepPartial<ChatSeen>[] = memberPlan.map(
                (member) => ({
                    chat: { id: chatId },
                    user: { id: member.id },
                    message: {
                        id: member.id === me.id ? seenId : lastId,
                    },
                }),
            );
            await manager.save(ChatSeen, seenRows);

            await manager.query(
                'UPDATE "chats" SET "updatedAt" = $2 WHERE id = $1',
                [chatId, lastAt],
            );

            return {
                messages: saved.length,
                serviceMessages: serviceCount,
                unreadForMe,
            };
        });

        this.logger.log(
            `[create] ${group.title}: ${memberPlan.length} members, ${outcome.messages} messages (${outcome.serviceMessages} service), unread=${outcome.unreadForMe}`,
        );

        return {
            created: true,
            members: memberPlan.length,
            messages: outcome.messages,
            serviceMessages: outcome.serviceMessages,
            unreadForMe: outcome.unreadForMe,
        };
    }

    private async permissionIds(): Promise<Map<PermissionChatEnum, number>> {
        const rows = await this.dataSource.getRepository(PermissionChat).find();
        return new Map(
            rows.map(
                (row) =>
                    [row.name as PermissionChatEnum, Number(row.id)] as const,
            ),
        );
    }

    private planMembers(
        group: DemoGroupSeed,
        index: number,
        me: MeUser,
        users: Map<string, ResolvedDemoUser>,
    ): GroupMember[] {
        const members: GroupMember[] = [];
        const seen = new Set<number>();
        const add = (
            user: ResolvedDemoUser | MeUser,
            username: string,
            name: string,
            role: RoleChatEnum,
            permission?: PermissionChatEnum,
        ): void => {
            if (seen.has(user.id)) return;
            seen.add(user.id);
            members.push({
                id: user.id,
                name,
                username,
                role,
                ...(permission ? { permission } : {}),
            });
        };

        const meAsMember = (role: RoleChatEnum): void => {
            if (seen.has(me.id)) return;
            add(me, me.username, me.name, role);
        };

        if (group.myRole === 'manager') {
            meAsMember(RoleChatEnum.MANAGER);
        } else {
            const managerSeed = DEMO_USERS.find(
                (seed) => seed.username === group.manager,
            );
            if (!managerSeed) {
                throw new Error(
                    `Group manager '${group.manager}' is not a demo user`,
                );
            }
            const manager = users.get(managerSeed.username);
            if (!manager) {
                throw new Error(`Demo user '${managerSeed.username}' missing`);
            }
            if (manager.id !== me.id) {
                add(
                    manager,
                    manager.username,
                    manager.name,
                    RoleChatEnum.MANAGER,
                );
            } else {
                meAsMember(RoleChatEnum.MANAGER);
            }
            meAsMember(roleForMe(group.myRole));
        }

        for (const admin of group.admins) {
            const user = users.get(admin.username);
            if (!user || user.id === me.id) continue;
            add(
                user,
                user.username,
                user.name,
                RoleChatEnum.ADMIN,
                admin.permission as PermissionChatEnum,
            );
        }

        if (group.myRole === 'admin' && !seen.has(me.id)) {
            meAsMember(RoleChatEnum.ADMIN);
        }

        const bannedSeed = group.banned
            ? DEMO_USERS.find((seed) => seed.username === group.banned)
            : undefined;
        if (bannedSeed) {
            const banned = users.get(bannedSeed.username);
            if (banned) {
                add(banned, banned.username, banned.name, RoleChatEnum.BAN);
            }
        }

        const rotated = [
            ...DEMO_USERS.slice(index % DEMO_USERS.length),
            ...DEMO_USERS.slice(0, index % DEMO_USERS.length),
        ];
        for (const seed of rotated) {
            if (members.length >= group.memberCount) break;
            if (seed.username === group.leaver) continue;
            if (seed.username === group.banned) continue;
            const user = users.get(seed.username);
            if (!user || user.id === me.id) continue;
            add(user, user.username, user.name, RoleChatEnum.USER);
        }

        if (members.length < group.memberCount) {
            // Include me even when a definition does not list a demo manager.
            meAsMember(roleForMe(group.myRole));
        }
        if (members.length > group.memberCount) {
            return members.slice(0, group.memberCount);
        }
        if (members.length < 3) {
            throw new Error(
                `${group.title} has ${members.length} members; demo groups need at least 3`,
            );
        }
        return members;
    }

    // --------------------------------------------------------------- messages

    private buildMessageSpecs(input: {
        group: DemoGroupSeed;
        index: number;
        me: MeUser;
        memberPlan: GroupMember[];
        users: Map<string, ResolvedDemoUser>;
        systemTypeId: number | null;
        rng: () => number;
        timelineStart: Date;
        timelineEnd: Date;
        leaverName: string;
    }): MessageSpec[] {
        const {
            group,
            index,
            me,
            memberPlan,
            users,
            systemTypeId,
            rng,
            timelineStart,
            timelineEnd,
            leaverName,
        } = input;
        const active = memberPlan.filter(
            (member) => member.role !== RoleChatEnum.BAN,
        );
        const others = active.filter((member) => member.id !== me.id);
        const manager =
            memberPlan.find((member) => member.role === RoleChatEnum.MANAGER) ??
            active[0];
        if (!manager) throw new Error(`No manager for ${group.title}`);

        const times = buildTimeline(
            rng,
            group.messageCount,
            timelineStart,
            timelineEnd,
        );
        const specs: MessageSpec[] = [];
        // Exactly ~28 % of the regular messages come from `SEED_ME`, across
        // all groups (not just on average): pick the positions deterministically.
        const mineCount = Math.round(times.length * 0.28);
        const minePositions = new Set<number>();
        while (minePositions.size < mineCount) {
            minePositions.add(Math.floor(rng() * times.length));
        }
        let longCursor = Math.floor(rng() * LONG_PERSIAN_MESSAGES.length);
        let multilineCursor = Math.floor(
            rng() * MULTILINE_PERSIAN_MESSAGES.length,
        );

        for (
            let messageIndex = 0;
            messageIndex < times.length;
            messageIndex += 1
        ) {
            const at = times[messageIndex];
            const sender =
                minePositions.has(messageIndex) || others.length === 0
                    ? me
                    : pick(rng, others);
            let content: string;
            if (messageIndex % 19 === 5) {
                content =
                    LONG_PERSIAN_MESSAGES[
                        longCursor % LONG_PERSIAN_MESSAGES.length
                    ];
                longCursor += 1;
            } else if (messageIndex % 13 === 7) {
                content =
                    MULTILINE_PERSIAN_MESSAGES[
                        multilineCursor % MULTILINE_PERSIAN_MESSAGES.length
                    ];
                multilineCursor += 1;
            } else {
                content = pick(rng, PERSIAN_MESSAGES);
            }

            const edited =
                messageIndex === Math.floor(group.messageCount * 0.33) ||
                messageIndex === Math.floor(group.messageCount * 0.71);

            specs.push({
                kind: 'text',
                at,
                senderId: sender.id,
                content,
                isEdited: edited,
                replyToIndex: null,
            });
        }

        if (systemTypeId !== null) {
            const addTargets = memberPlan
                .filter((member) => member.id !== manager.id)
                .slice(0, 2);
            const createdAt = new Date(timelineStart.getTime() - 3 * HOUR_MS);
            addTargets.forEach((target, targetIndex) => {
                const meta: ServiceMessageMeta = {
                    action: 'member_added',
                    actorId: manager.id,
                    actorName: manager.name,
                    targetId: target.id,
                    targetName: target.name,
                };
                specs.push({
                    kind: 'system',
                    at: new Date(
                        createdAt.getTime() + (5 + targetIndex * 7) * 60 * 1000,
                    ),
                    senderId: manager.id,
                    content: serviceMessageContent(
                        meta.action,
                        manager.name,
                        target.name,
                    ),
                    meta,
                });
            });

            const joinTarget = memberPlan.filter(
                (member) =>
                    member.id !== manager.id &&
                    member.id !== me.id &&
                    member.role !== RoleChatEnum.BAN &&
                    !addTargets.some((target) => target.id === member.id),
            )[0];
            if (joinTarget) {
                const at = new Date(
                    timelineStart.getTime() + 2.2 * DAY_MS + index * HOUR_MS,
                );
                const meta: ServiceMessageMeta = {
                    action: 'member_joined_via_link',
                    actorId: joinTarget.id,
                    actorName: joinTarget.name,
                    targetId: joinTarget.id,
                    targetName: joinTarget.name,
                };
                specs.push({
                    kind: 'system',
                    at,
                    senderId: joinTarget.id,
                    content: serviceMessageContent(
                        meta.action,
                        joinTarget.name,
                        joinTarget.name,
                    ),
                    meta,
                });
            }

            const leaverSeed = DEMO_USERS.find(
                (seed) => seed.username === group.leaver,
            );
            const leaverId = users.get(group.leaver)?.id;
            if (leaverSeed && leaverId !== undefined) {
                const at = new Date(
                    timelineStart.getTime() + 7 * DAY_MS + index * HOUR_MS,
                );
                const meta: ServiceMessageMeta = {
                    action: 'member_left',
                    actorId: leaverId,
                    actorName: leaverName,
                    targetId: leaverId,
                    targetName: leaverName,
                };
                specs.push({
                    kind: 'system',
                    at,
                    senderId: leaverId,
                    content: serviceMessageContent(
                        meta.action,
                        leaverName,
                        leaverName,
                    ),
                    meta,
                });
            }

            const bannedMember = memberPlan.find(
                (member) => member.role === RoleChatEnum.BAN,
            );
            if (bannedMember) {
                const at = new Date(timelineEnd.getTime() - 6 * HOUR_MS);
                const meta: ServiceMessageMeta = {
                    action: 'member_banned',
                    actorId: manager.id,
                    actorName: manager.name,
                    targetId: bannedMember.id,
                    targetName: bannedMember.name,
                };
                specs.push({
                    kind: 'system',
                    at,
                    senderId: manager.id,
                    content: serviceMessageContent(
                        meta.action,
                        manager.name,
                        bannedMember.name,
                    ),
                    meta,
                });
            }
        }

        specs.sort((left, right) => left.at.getTime() - right.at.getTime());
        // Strictly increasing message ids/timestamps inside one chat.
        for (let specIndex = 1; specIndex < specs.length; specIndex += 1) {
            const previous = specs[specIndex - 1];
            const current = specs[specIndex];
            if (current.at.getTime() <= previous.at.getTime()) {
                current.at = new Date(previous.at.getTime() + 1000);
            }
        }

        this.markReplies(specs);
        return specs;
    }

    private markReplies(specs: MessageSpec[]): void {
        const textIndexes = specs
            .map((spec, specIndex) => (spec.kind === 'text' ? specIndex : -1))
            .filter((specIndex) => specIndex >= 0);
        for (const fraction of [0.62, 0.86]) {
            const sourcePosition = Math.floor(textIndexes.length * fraction);
            const targetPosition = sourcePosition - 5;
            if (targetPosition < 0 || sourcePosition >= textIndexes.length) {
                continue;
            }
            const sourceIndex = textIndexes[sourcePosition];
            const targetIndex = textIndexes[targetPosition];
            const source = specs[sourceIndex];
            if (source?.kind === 'text' && source.replyToIndex === null) {
                source.replyToIndex = targetIndex;
            }
        }
    }

    private async insertMessages(
        manager: EntityManager,
        chatId: number,
        specs: MessageSpec[],
        textTypeId: number,
        systemTypeId: number | null,
    ): Promise<{ saved: Message[]; serviceCount: number }> {
        const repository = manager.getRepository(Message);
        const rows: DeepPartial<Message>[] = specs.map((spec) => ({
            content: spec.content,
            sender: { id: spec.senderId },
            chat: { id: chatId },
            type: {
                id:
                    spec.kind === 'system'
                        ? (systemTypeId ?? textTypeId)
                        : textTypeId,
            },
            isEdited: spec.kind === 'text' ? spec.isEdited : false,
            meta: spec.kind === 'system' ? spec.meta : null,
            createdAt: spec.at,
            updatedAt: new Date(
                spec.at.getTime() +
                    (spec.kind === 'text' && spec.isEdited
                        ? 20 * 60 * 1000
                        : 0),
            ),
        }));

        const saved: Message[] = [];
        for (
            let offset = 0;
            offset < rows.length;
            offset += MESSAGE_INSERT_BATCH
        ) {
            const batch = rows.slice(offset, offset + MESSAGE_INSERT_BATCH);
            const inserted = await repository.save(batch);
            saved.push(...inserted);
        }
        return {
            saved,
            serviceCount:
                systemTypeId === null
                    ? 0
                    : specs.filter((spec) => spec.kind === 'system').length,
        };
    }

    private async applyReplyLinks(
        manager: EntityManager,
        specs: MessageSpec[],
        saved: Message[],
    ): Promise<void> {
        for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
            const spec = specs[specIndex];
            if (!spec || spec.kind !== 'text' || spec.replyToIndex === null) {
                continue;
            }
            const target = specs[spec.replyToIndex];
            const targetSaved = saved[spec.replyToIndex];
            const sourceSaved = saved[specIndex];
            if (
                !target ||
                target.kind !== 'text' ||
                !targetSaved ||
                !sourceSaved
            ) {
                continue;
            }
            await manager.query(
                'UPDATE "messages" SET "replyToId" = $2 WHERE id = $1',
                [Number(sourceSaved.id), Number(targetSaved.id)],
            );
        }
    }

    private async insertReactions(
        manager: EntityManager,
        specs: MessageSpec[],
        saved: Message[],
        activeMembers: GroupMember[],
    ): Promise<void> {
        const reacts = await manager.getRepository(React).find({
            take: 6,
            order: { id: 'ASC' },
        });
        if (reacts.length === 0 || saved.length === 0) return;

        const textRows = specs
            .map((spec, specIndex) => ({ spec, message: saved[specIndex] }))
            .filter(
                (row) => row.spec.kind === 'text' && row.message !== undefined,
            );
        const candidates = [0.38, 0.63, 0.88]
            .map(
                (fraction) =>
                    textRows[Math.floor(textRows.length * fraction)]?.message,
            )
            .filter((message): message is Message => message !== undefined);
        const rows: DeepPartial<MessageReact>[] = [];
        const used = new Set<string>();
        for (let index = 0; index < candidates.length; index += 1) {
            const message = candidates[index];
            const senderId = Number(
                (message.sender as { id?: number } | undefined)?.id ?? 0,
            );
            const reactors = activeMembers.filter(
                (member) => member.id !== senderId,
            );
            const reactor = reactors[index % reactors.length];
            if (!reactor) continue;
            const key = `${message.id}:${reactor.id}`;
            if (used.has(key)) continue;
            used.add(key);
            rows.push({
                message: { id: Number(message.id) },
                user: { id: reactor.id },
                react: {
                    id: Number(reacts[index % reacts.length].id),
                },
            });
        }
        if (rows.length > 0) {
            await manager.save(MessageReact, rows);
        }
    }

    // ------------------------------------------------------------------ reset

    private async resetDemoData(preserveUserId: number): Promise<{
        users: number;
        chats: number;
        messages: number;
    }> {
        return this.dataSource.transaction(async (manager) => {
            const profiles = await manager.getRepository(UserProfile).find({
                where: {
                    username: In(DEMO_USERS.map((seed) => seed.username)),
                },
                relations: { user: true },
            });
            const userIds = profiles
                .map((profile) => profile.user)
                .filter((user): user is User => user !== undefined)
                .map((user) => Number(user.id))
                // `SEED_ME` may itself be a demo account: never delete the
                // account the seeder is asked to join groups with.
                .filter((id) => id !== preserveUserId);

            const chats = await manager.getRepository(Chat).find({
                where: {
                    title: In(DEMO_GROUPS.map((group) => group.title)),
                    type: TypeChatEnum.GRUPE,
                },
                select: { id: true },
            });
            const chatIds = chats.map((chat) => Number(chat.id));

            const messageCount = await this.countDemoMessages(
                manager,
                userIds,
                chatIds,
            );

            if (chatIds.length > 0 || userIds.length > 0) {
                await manager.query(
                    `UPDATE "messages" SET "replyToId" = NULL
                      WHERE "replyToId" IN (
                          SELECT id FROM "messages"
                           WHERE "chatId" = ANY($1::bigint[])
                              OR "senderId" = ANY($2::bigint[])
                      )`,
                    [chatIds, userIds],
                );
                await manager.query(
                    `DELETE FROM "messages"
                      WHERE "chatId" = ANY($1::bigint[])
                         OR "senderId" = ANY($2::bigint[])`,
                    [chatIds, userIds],
                );
            }
            if (chatIds.length > 0) {
                await manager.query(
                    'DELETE FROM "chats" WHERE id = ANY($1::bigint[])',
                    [chatIds],
                );
            }
            if (userIds.length > 0) {
                await manager.query(
                    'DELETE FROM "users" WHERE id = ANY($1::bigint[])',
                    [userIds],
                );
            }

            return {
                users: userIds.length,
                chats: chatIds.length,
                messages: messageCount,
            };
        });
    }

    private async countDemoMessages(
        manager: EntityManager,
        userIds: number[],
        chatIds: number[],
    ): Promise<number> {
        if (chatIds.length === 0 && userIds.length === 0) return 0;
        const rows = await manager.query<Array<{ count: string }>>(
            `SELECT COUNT(*)::text AS count FROM "messages"
              WHERE "chatId" = ANY($1::bigint[])
                 OR "senderId" = ANY($2::bigint[])`,
            [chatIds, userIds],
        );
        return Number(rows[0]?.count ?? 0);
    }
}

function roleForMe(role: DemoGroupSeed['myRole']): RoleChatEnum {
    if (role === 'manager') return RoleChatEnum.MANAGER;
    if (role === 'admin') return RoleChatEnum.ADMIN;
    return RoleChatEnum.USER;
}

function phoneVariants(identifier: string): string[] {
    const trimmed = identifier.replace(/\s+/g, '');
    if (!/^\+?\d+$/.test(trimmed)) return [];
    const variants = new Set<string>([trimmed]);
    if (trimmed.startsWith('+98')) variants.add(`0${trimmed.slice(3)}`);
    if (trimmed.startsWith('0098')) variants.add(`0${trimmed.slice(4)}`);
    if (trimmed.startsWith('0')) variants.add(`+98${trimmed.slice(1)}`);
    return [...variants];
}

function buildTimeline(
    rng: () => number,
    count: number,
    start: Date,
    end: Date,
): Date[] {
    const times: Date[] = [];
    // Average ~4.5 messages per burst, so every burst stays in the 3-6 range
    // and the bursts are spread across the WHOLE window (last one near now).
    const burstCount = Math.max(1, Math.round(count / 4.5));
    const span = end.getTime() - start.getTime();
    const baseSize = Math.floor(count / burstCount);
    const extra = count - baseSize * burstCount;

    for (let burst = 0; burst < burstCount; burst += 1) {
        const slotSize = span / burstCount;
        const anchor =
            burstCount === 1
                ? start.getTime()
                : start.getTime() + (span * burst) / (burstCount - 1);
        const jitter =
            burst === 0 || burst === burstCount - 1
                ? 0
                : (rng() - 0.5) * slotSize * 0.25;
        const base = Math.min(
            Math.max(anchor + jitter, start.getTime()),
            end.getTime(),
        );
        const size = baseSize + (burst < extra ? 1 : 0);
        for (let inside = 0; inside < size; inside += 1) {
            const offset = inside === 0 ? 0 : (20 + rng() * 280) * 1000;
            const previous =
                times.length === 0
                    ? base - 1
                    : times[times.length - 1].getTime();
            times.push(new Date(Math.max(base + offset, previous + 1000)));
        }
    }

    const last = times[times.length - 1];
    if (last && last.getTime() > end.getTime()) {
        const overflow = last.getTime() - end.getTime() + 1000;
        for (let index = 0; index < times.length; index += 1) {
            times[index] = new Date(times[index].getTime() - overflow);
        }
    }
    return times;
}
