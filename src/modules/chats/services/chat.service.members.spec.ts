import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatService } from './chat.service';

interface MemberQueryBuilder {
    innerJoin: () => MemberQueryBuilder;
    where: () => MemberQueryBuilder;
    andWhere: (
        column: string,
        params: Record<string, unknown>,
    ) => MemberQueryBuilder;
    select: () => MemberQueryBuilder;
    getRawOne: () => Promise<{ count: string }>;
}

/** `chatInfo.membersCount` counts non-banned members in one query. */
describe('ChatService membersCount', () => {
    it('counts active members with the ban role excluded by name', async () => {
        const filters: Array<[string, Record<string, unknown>]> = [];
        const builder: MemberQueryBuilder = {
            innerJoin: () => builder,
            where: () => builder,
            andWhere: (column, params) => {
                filters.push([column, params]);
                return builder;
            },
            select: () => builder,
            getRawOne: () => Promise.resolve({ count: '3' }),
        };
        const memberRepo = {
            createQueryBuilder: () => builder,
        };
        const access = {
            getCallerContext: () =>
                Promise.resolve({
                    chat: { id: 1, type: TypeChatEnum.GRUPE },
                    roleName: RoleChatEnum.USER,
                    isManager: false,
                    isAdmin: false,
                    permissions: [],
                }),
        };
        const service = new ChatService(
            {} as never,
            memberRepo as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            access as never,
            {} as never,
        );

        const summary = await service.getChatSummary(1 as never, 2 as never);

        expect(summary.membersCount).toBe(3);
        expect(filters).toContainEqual([
            'role.name != :banRole',
            { banRole: RoleChatEnum.BAN },
        ]);
    });
});
