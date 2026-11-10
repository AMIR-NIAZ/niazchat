import { ServiceUnavailableException } from '@nestjs/common';
import { ForwardRequestStore } from './forward-request.store';

describe('ForwardRequestStore (memory fallback)', () => {
    const originalHost = process.env.REDIS_HOST;

    beforeEach(() => {
        delete process.env.REDIS_HOST;
    });

    afterAll(() => {
        if (originalHost === undefined) {
            delete process.env.REDIS_HOST;
        } else {
            process.env.REDIS_HOST = originalHost;
        }
    });

    it('runs two concurrent identical requests once and returns the same result', async () => {
        const store = new ForwardRequestStore();
        let runs = 0;
        const run = async (): Promise<{ id: number }> => {
            runs += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { id: 7 };
        };
        const [first, second] = await Promise.all([
            store.runIdempotent('key', run),
            store.runIdempotent('key', run),
        ]);
        expect(runs).toBe(1);
        expect(first.value).toEqual({ id: 7 });
        expect(second).toEqual({ value: { id: 7 }, cached: true });
    });

    it('releases the key after a failure so a retry can run', async () => {
        const store = new ForwardRequestStore();
        await expect(
            store.runIdempotent('key', async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        await expect(
            store.runIdempotent('key', async () => 'ok'),
        ).resolves.toEqual({ value: 'ok', cached: false });
    });

    it('allows 20 forward requests per minute and rejects the 21st', async () => {
        const store = new ForwardRequestStore();
        for (let i = 0; i < 20; i += 1) {
            await expect(store.assertRateLimit(4)).resolves.toBeUndefined();
        }
        await expect(store.assertRateLimit(4)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });
});
