import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { promises as fsPromises, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserService } from './user.service';
import { ensureAvatarDirectory } from '../utils/avatar.util';

const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
]);

const uploader = { sub: 1, role: 'user' } as never;

/**
 * In-memory profile store. `transaction` serializes whole transactions, which
 * is what the `FOR UPDATE` row lock gives the real service, so the concurrency
 * assertions exercise the same critical section.
 */
class FakeProfileStore {
    avatars: string[] = [];
    private tail: Promise<void> = Promise.resolve();

    async transaction<T>(
        work: (manager: EntityManager) => Promise<T>,
    ): Promise<T> {
        const previous = this.tail;
        let release: () => void = () => undefined;
        this.tail = new Promise<void>((resolve): void => {
            release = resolve;
        });
        await previous;
        try {
            return await work(this.manager());
        } finally {
            release();
        }
    }

    private manager(): EntityManager {
        return {
            query: (rawSql: string, parameters: unknown[] = []) => {
                const sql = rawSql.replace(/\s+/g, ' ');
                if (sql.includes('INSERT INTO "user_profiles"')) {
                    return Promise.resolve([]);
                }
                if (sql.includes('FOR UPDATE')) {
                    return Promise.resolve([
                        { id: '1', avatars: [...this.avatars] },
                    ]);
                }
                if (
                    sql.includes(
                        'array_prepend($1::text, array_remove("avatars", $1::text))',
                    )
                ) {
                    const value = parameters[0] as string;
                    this.avatars = [
                        value,
                        ...this.avatars.filter((avatar) => avatar !== value),
                    ];
                    return Promise.resolve([]);
                }
                if (sql.includes('array_prepend($1::text, "avatars")')) {
                    this.avatars = [parameters[0] as string, ...this.avatars];
                    return Promise.resolve([]);
                }
                if (sql.includes('array_remove("avatars", $1::text)')) {
                    const value = parameters[0] as string;
                    this.avatars = this.avatars.filter(
                        (avatar) => avatar !== value,
                    );
                    return Promise.resolve([]);
                }
                return Promise.resolve([]);
            },
        } as unknown as EntityManager;
    }
}

describe('UserService avatars', () => {
    let store: FakeProfileStore;
    let service: UserService;
    let userRepository: { findOne: jest.Mock };
    const createdFiles: string[] = [];

    const makeFile = (fileName: string): Express.Multer.File => {
        const filePath = join(ensureAvatarDirectory(), fileName);
        writeFileSync(filePath, PNG_BYTES);
        createdFiles.push(filePath);
        return {
            path: filePath,
            mimetype: 'image/png',
            size: PNG_BYTES.length,
            originalname: 'ignored-name.png',
        } as Express.Multer.File;
    };

    const stored = (fileName: string): string => `uploads/avatars/${fileName}`;

    beforeEach(() => {
        store = new FakeProfileStore();
        userRepository = {
            findOne: jest.fn(() =>
                Promise.resolve({
                    id: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    phone: '+989120000000',
                    isOnline: false,
                    lastSeen: null,
                    status: 'active',
                    role: { id: 1, name: 'user' },
                    profile: { avatars: [...store.avatars] },
                }),
            ),
        };
        const profileRepository = {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        };
        service = new UserService(
            userRepository as never,
            profileRepository as never,
            store as never,
            { consume: jest.fn() } as never,
        );
    });

    afterEach(async () => {
        await Promise.all(
            createdFiles
                .splice(0)
                .map((filePath) => fsPromises.rm(filePath, { force: true })),
        );
    });

    it('prepends a new upload as the current avatar', async () => {
        store.avatars = [stored('older.png')];

        const result = await service.uploadAvatar(
            makeFile('newer.png'),
            uploader,
        );

        expect(store.avatars).toEqual([
            stored('newer.png'),
            stored('older.png'),
        ]);
        expect(result.user.avatars).toEqual(store.avatars);
    });

    it('rejects the 11th upload and removes the just-stored file', async () => {
        store.avatars = Array.from({ length: 10 }, (_value, index) =>
            stored(`photo-${index}.png`),
        );
        const eleventh = makeFile('eleventh.png');

        await expect(service.uploadAvatar(eleventh, uploader)).rejects.toThrow(
            BadRequestException,
        );

        expect(store.avatars).toHaveLength(10);
        expect(existsSync(eleventh.path)).toBe(false);
    });

    it('never loses an entry under concurrent uploads', async () => {
        const files = Array.from({ length: 5 }, (_value, index) =>
            makeFile(`concurrent-${index}.png`),
        );

        await Promise.all(
            files.map((file) => service.uploadAvatar(file, uploader)),
        );

        expect(store.avatars).toHaveLength(5);
        expect(new Set(store.avatars).size).toBe(5);
    });

    it('enforces the limit under concurrent uploads', async () => {
        store.avatars = Array.from({ length: 9 }, (_value, index) =>
            stored(`fill-${index}.png`),
        );
        const [first, second] = [
            makeFile('race-a.png'),
            makeFile('race-b.png'),
        ];

        const outcomes = await Promise.allSettled([
            service.uploadAvatar(first, uploader),
            service.uploadAvatar(second, uploader),
        ]);

        expect(store.avatars).toHaveLength(10);
        expect(
            outcomes.filter((outcome) => outcome.status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = outcomes.find(
            (outcome) => outcome.status === 'rejected',
        );
        expect(rejected).toBeDefined();
        if (rejected?.status === 'rejected') {
            expect(rejected.reason).toBeInstanceOf(BadRequestException);
        }
    });

    it('deletes a non-current avatar and its file', async () => {
        const target = makeFile('b.png');
        store.avatars = [stored('a.png'), stored('b.png'), stored('c.png')];

        const result = await service.removeAvatar('b.png', uploader);

        expect(store.avatars).toEqual([stored('a.png'), stored('c.png')]);
        expect(existsSync(target.path)).toBe(false);
        expect(result.user.avatars).toEqual([stored('a.png'), stored('c.png')]);
    });

    it('promotes the next avatar when the current one is deleted', async () => {
        makeFile('current.png');
        makeFile('next.png');
        store.avatars = [stored('current.png'), stored('next.png')];

        await service.removeAvatar('current.png', uploader);

        expect(store.avatars).toEqual([stored('next.png')]);
    });

    it('leaves an empty array after deleting the last avatar', async () => {
        makeFile('only.png');
        store.avatars = [stored('only.png')];

        const result = await service.removeAvatar('only.png', uploader);

        expect(store.avatars).toEqual([]);
        expect(result.user.avatars).toEqual([]);
    });

    it('rejects a file name that is not in the caller array', async () => {
        store.avatars = [stored('mine.png')];

        await expect(
            service.removeAvatar('someone-else.png', uploader),
        ).rejects.toThrow(NotFoundException);
        expect(store.avatars).toEqual([stored('mine.png')]);
    });

    it('rejects path-traversal file names', async () => {
        store.avatars = [stored('mine.png')];

        await expect(
            service.removeAvatar('../../etc/passwd', uploader),
        ).rejects.toThrow(BadRequestException);
        await expect(
            service.setMainAvatar('../mine.png', uploader),
        ).rejects.toThrow(BadRequestException);
        expect(store.avatars).toEqual([stored('mine.png')]);
    });

    it('moves a chosen avatar to index 0 keeping the others in order', async () => {
        store.avatars = [stored('a.png'), stored('b.png'), stored('c.png')];

        await service.setMainAvatar('c.png', uploader);
        expect(store.avatars).toEqual([
            stored('c.png'),
            stored('a.png'),
            stored('b.png'),
        ]);

        await service.setMainAvatar('a.png', uploader);
        expect(store.avatars).toEqual([
            stored('a.png'),
            stored('c.png'),
            stored('b.png'),
        ]);
    });

    it('rejects promoting a file name the caller does not own', async () => {
        store.avatars = [stored('mine.png')];

        await expect(
            service.setMainAvatar('foreign.png', uploader),
        ).rejects.toThrow(NotFoundException);
        expect(store.avatars).toEqual([stored('mine.png')]);
    });

    it('keeps the legacy delete route path-based and response-compatible', async () => {
        makeFile('legacy.png');
        store.avatars = [stored('legacy.png')];

        const result = await service.deleteAvatar(
            stored('legacy.png'),
            uploader,
        );

        expect(result).toEqual({ message: 'avatar updated successfully' });
        expect(store.avatars).toEqual([]);
    });
});
