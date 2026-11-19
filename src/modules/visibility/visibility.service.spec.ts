import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
    GROUP_NOT_AVAILABLE_MESSAGE,
    USER_NOT_AVAILABLE_MESSAGE,
    VisibilityService,
} from './visibility.service';

/**
 * The single visibility gate:
 *   - a block is directional: only the blocked side loses the blocker's data;
 *   - group visibility follows the `ban` role;
 *   - the generic errors never reveal whether the target exists.
 */
describe('VisibilityService', () => {
    const VIEWER = 1;
    const TARGET = 2;

    function setup(state: {
        blockedByTarget?: boolean;
        blockedByViewer?: boolean;
        blockers?: number[];
        relations?: Array<{ blockerId: number; blockedId: number }>;
        banned?: boolean;
    }) {
        const blockRepository = {
            query: jest.fn((sql: string, params: unknown[] = []) => {
                const [first, second] = params.map(Number);
                if (sql.includes('"blockerId" = $1 AND "blockedId" = $2')) {
                    return Promise.resolve([
                        {
                            exists:
                                first === TARGET &&
                                second === VIEWER &&
                                state.blockedByTarget === true,
                        },
                    ]);
                }
                if (sql.includes('("blockerId" = $1 AND "blockedId" = $2)')) {
                    return Promise.resolve([
                        {
                            exists:
                                (first === TARGET &&
                                    second === VIEWER &&
                                    state.blockedByTarget === true) ||
                                (first === VIEWER &&
                                    second === TARGET &&
                                    state.blockedByViewer === true),
                        },
                    ]);
                }
                if (sql.includes('"blockerId" = ANY')) {
                    return Promise.resolve(
                        (state.blockers ?? []).map((blockerId) => ({
                            blockerId,
                        })),
                    );
                }
                if (sql.includes('blocked_member')) {
                    return Promise.resolve(state.relations ?? []);
                }
                return Promise.resolve([]);
            }),
        };
        const memberRepository = {
            query: jest.fn((_sql: string, params: unknown[] = []) =>
                Promise.resolve([
                    {
                        exists:
                            state.banned === true && Number(params[0]) === 10,
                    },
                ]),
            ),
        };
        const service = new VisibilityService(
            blockRepository as never,
            memberRepository as never,
        );
        return { service, blockRepository, memberRepository };
    }

    it('is direction-aware: only the blocked viewer loses the profile', async () => {
        const { service } = setup({ blockedByTarget: true });
        await expect(service.isBlockedBy(VIEWER, TARGET)).resolves.toBe(true);
        await expect(service.canViewUserProfile(VIEWER, TARGET)).resolves.toBe(
            false,
        );
        await expect(service.isBlockedBy(TARGET, VIEWER)).resolves.toBe(false);
        await expect(service.canViewUserProfile(TARGET, VIEWER)).resolves.toBe(
            true,
        );
    });

    it('never treats the caller as blocked by themselves', async () => {
        const { service, blockRepository } = setup({ blockedByTarget: true });
        await expect(service.isBlockedBy(VIEWER, VIEWER)).resolves.toBe(false);
        await expect(service.isBlockedBetween(VIEWER, VIEWER)).resolves.toBe(
            false,
        );
        expect(blockRepository.query).not.toHaveBeenCalled();
    });

    it('batches the blockers of a viewer in ONE query', async () => {
        const { service, blockRepository } = setup({ blockers: [7, 9] });
        const hidden = await service.blockersOfViewer(VIEWER, [7, 8, 9, 1]);
        expect([...hidden].sort()).toEqual([7, 9]);
        expect(blockRepository.query).toHaveBeenCalledTimes(1);
        expect(blockRepository.query.mock.calls[0][1]).toEqual([
            VIEWER,
            [7, 8, 9],
        ]);
    });

    it('keeps only block relations between two members of the chat', async () => {
        const { service } = setup({
            relations: [{ blockerId: 5, blockedId: 6 }],
        });
        await expect(service.blockedRelationsInChat(10)).resolves.toEqual([
            { blockerId: 5, blockedId: 6 },
        ]);
        expect(
            service.hiddenUserIdsFor(6, [{ blockerId: 5, blockedId: 6 }]),
        ).toEqual(new Set([5]));
        expect(
            service.hiddenUserIdsFor(5, [{ blockerId: 5, blockedId: 6 }]),
        ).toEqual(new Set());
    });

    it('a banned membership hides the group, everyone else keeps access', async () => {
        const banned = setup({ banned: true });
        await expect(banned.service.isBannedFromChat(VIEWER, 10)).resolves.toBe(
            true,
        );
        await expect(banned.service.canViewGroup(VIEWER, 10)).resolves.toBe(
            false,
        );
        await expect(banned.service.canViewGroup(VIEWER, 11)).resolves.toBe(
            true,
        );
        expect(banned.memberRepository.query).toHaveBeenCalledWith(
            expect.stringContaining('role.name = $3'),
            [10, VIEWER, 'ban'],
        );
    });

    it('answers the same generic 404 for a hidden profile', async () => {
        const { service } = setup({ blockedByTarget: true });
        await expect(
            service.assertCanViewUserProfile(VIEWER, TARGET),
        ).rejects.toEqual(new NotFoundException(USER_NOT_AVAILABLE_MESSAGE));
    });

    it('answers the shared group 403 for a banned viewer', async () => {
        const { service } = setup({ banned: true });
        await expect(service.assertCanViewGroup(VIEWER, 10)).rejects.toEqual(
            new ForbiddenException(GROUP_NOT_AVAILABLE_MESSAGE),
        );
    });
});
