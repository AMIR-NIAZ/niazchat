import { NotFoundException } from '@nestjs/common';
import { toPublicUserProfile } from '../utils/public-profile.util';
import { UserService } from './user.service';

/**
 * `GET /user/:userId/profile`: the public projection must never leak the
 * private user columns, and unknown / inactive users must be uniformly 404.
 */

function person(overrides: Record<string, unknown> = {}) {
    return {
        id: 42,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        phone: '+989120000000',
        refreshToken: 'refresh-secret',
        isOnline: true,
        lastSeen: new Date('2026-02-01T10:00:00Z'),
        status: 'active',
        role: { id: 3, name: 'user' },
        profile: {
            id: 7,
            name: 'Sara',
            username: 'sara_1990',
            biografy: 'hello',
            avatars: [
                'uploads/avatars/current.png',
                'uploads/avatars/second.png',
                'uploads/avatars/third.png',
            ],
        },
        ...overrides,
    };
}

function makeService(findOne: jest.Mock): UserService {
    const userRepository = { findOne };
    const profileRepository = {};
    const dataSource = {};
    return new UserService(
        userRepository as never,
        profileRepository as never,
        dataSource as never,
    );
}

describe('toPublicUserProfile', () => {
    it('returns exactly the public fields, never phone or tokens', () => {
        const result = toPublicUserProfile(person() as never);

        expect(Object.keys(result).sort()).toEqual([
            'avatars',
            'biografy',
            'id',
            'isOnline',
            'lastSeen',
            'name',
            'username',
        ]);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('+98912');
        expect(serialized).not.toContain('refresh-secret');
        expect(result).not.toHaveProperty('phone');
        expect(result).not.toHaveProperty('status');
        expect(result).not.toHaveProperty('role');
    });

    it('keeps every avatar with the current one first', () => {
        const result = toPublicUserProfile(person() as never);

        expect(result.avatars).toEqual([
            'uploads/avatars/current.png',
            'uploads/avatars/second.png',
            'uploads/avatars/third.png',
        ]);
    });

    it('copies the avatar array instead of sharing the entity one', () => {
        const source = person();
        const result = toPublicUserProfile(source as never);
        result.avatars.push('uploads/avatars/injected.png');

        expect(source.profile.avatars).toHaveLength(3);
    });

    it('falls back to no avatar, no username and null presence', () => {
        const result = toPublicUserProfile(
            person({
                isOnline: false,
                lastSeen: null,
                profile: null,
            }) as never,
        );

        expect(result).toMatchObject({
            id: 42,
            name: 'بدون نام',
            username: null,
            biografy: null,
            avatars: [],
            isOnline: false,
            lastSeen: null,
        });
    });
});

describe('UserService.getPublicProfile', () => {
    it('returns the public profile for an active user', async () => {
        const findOne = jest.fn().mockResolvedValue(person());
        const service = makeService(findOne);

        const result = await service.getPublicProfile(42);

        expect(result.id).toBe(42);
        expect(result.name).toBe('Sara');
        expect(findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 42, status: 'active' },
                relations: { profile: true },
            }),
        );
    });

    it('404s for a non-existent id', async () => {
        const service = makeService(jest.fn().mockResolvedValue(null));

        await expect(service.getPublicProfile(999_999)).rejects.toThrow(
            new NotFoundException('User not found'),
        );
    });

    it.each(['baned', 'deleted'])(
        '404s for an inactive (%s) user',
        async () => {
            const service = makeService(jest.fn().mockResolvedValue(null));

            await expect(service.getPublicProfile(42)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        },
    );

    it.each([0, -1, 1.5])(
        'rejects a non-positive/non-integer id (%s)',
        async (id) => {
            const findOne = jest.fn();
            const service = makeService(findOne);

            await expect(service.getPublicProfile(id)).rejects.toThrow(
                'userId must be a positive integer',
            );
            expect(findOne).not.toHaveBeenCalled();
        },
    );
});
