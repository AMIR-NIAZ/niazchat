import { BadRequestException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ManageChatsController } from 'src/modules/chats/controllers/manageChats.controller';
import { ManagerChatGuard } from './ManagerChatGuard.guard';

/**
 * Every decorated route of `/chats/manage/*` must pass through the shared
 * group-type gate. A private chat is rejected with 400 before any role or
 * permission check, so no group-only action is reachable per route.
 */

const prototype = ManageChatsController.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
>;

const routeMethods = Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => {
        const path: unknown = Reflect.getMetadata(
            PATH_METADATA,
            prototype[name],
        );
        return path !== undefined;
    });

function pathOf(handler: (...args: unknown[]) => unknown): string {
    const metadata = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | string[];
    return Array.isArray(metadata) ? (metadata[0] ?? '') : metadata;
}

function paramsOf(path: string): Record<string, string | number> {
    const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map(
        (match) => match[1],
    );
    return Object.fromEntries(
        names.map((name) => [
            name,
            name === 'memberId'
                ? 7
                : name === 'chatId' || name === 'groupId'
                  ? 5
                  : 'x',
        ]),
    );
}

function contextFor(
    handler: (...args: unknown[]) => unknown,
    params: Record<string, string | number>,
): ExecutionContext {
    const request = { user: { sub: 1 }, params };
    return {
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

function buildGuard() {
    const access = {
        getCallerContext: jest.fn().mockResolvedValue({
            chat: { id: 5, type: 'private' },
            roleName: 'user',
            isManager: false,
            isAdmin: false,
            permissions: [],
            member: { id: 3 },
        }),
        getTargetMember: jest.fn().mockResolvedValue({
            id: 7,
            chat: { id: 5, type: 'private' },
            role: { name: 'user' },
        }),
        assertUsableGroup: jest.fn(() => {
            throw new BadRequestException(
                'This action is only available in groups',
            );
        }),
        assertRole: jest.fn(),
        assertPermissions: jest.fn(),
    };
    const reflector = { get: jest.fn().mockReturnValue(undefined) };
    return {
        guard: new ManagerChatGuard(reflector as never, access as never),
        access,
    };
}

describe('ManagerChatGuard — group-only routes', () => {
    it('finds every manage route', () => {
        expect(routeMethods.length).toBeGreaterThan(10);
    });

    it.each(routeMethods)(
        'rejects a private chat on %s with 400',
        async (method) => {
            const handler = prototype[method] as (
                ...args: unknown[]
            ) => unknown;
            const path = pathOf(handler);
            const params = paramsOf(path);
            const { guard, access } = buildGuard();

            await expect(
                guard.canActivate(contextFor(handler, params)),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                guard.canActivate(contextFor(handler, params)),
            ).rejects.toThrow('This action is only available in groups');
            expect(access.assertUsableGroup).toHaveBeenCalled();
            expect(access.assertRole).not.toHaveBeenCalled();
        },
    );
});
