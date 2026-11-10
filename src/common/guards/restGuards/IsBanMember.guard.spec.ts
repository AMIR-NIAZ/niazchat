import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { IsBanMember } from './IsBanMember.guard';
import { RoleChatEnum } from '../../enums/roleChat.enum';

function contextFor(chatId = '1', userId = 2): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                params: { chatId },
                user: { sub: userId },
            }),
        }),
    } as unknown as ExecutionContext;
}

function membership(roleName: RoleChatEnum) {
    return {
        role: { id: roleName === RoleChatEnum.BAN ? 1 : 2, name: roleName },
    };
}

describe('IsBanMember', () => {
    const memberRepository = {
        findOne: jest.fn(),
    };
    const roleChatRepository = {
        findOne: jest.fn(),
    };
    const guard = new IsBanMember(
        memberRepository as never,
        roleChatRepository as never,
    );

    beforeEach(() => {
        jest.clearAllMocks();
        roleChatRepository.findOne.mockResolvedValue({
            id: 1,
            name: RoleChatEnum.BAN,
        });
    });

    it('loads the member role relation before reading role.id', async () => {
        memberRepository.findOne.mockResolvedValue(
            membership(RoleChatEnum.USER),
        );

        await expect(guard.canActivate(contextFor())).resolves.toBe(true);
        expect(memberRepository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ relations: { role: true } }),
        );
    });

    it('rejects a banned chat member', async () => {
        memberRepository.findOne.mockResolvedValue(
            membership(RoleChatEnum.BAN),
        );

        await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(
            ForbiddenException,
        );
    });
});
