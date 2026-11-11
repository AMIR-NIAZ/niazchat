import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInviteLinkDto } from './createInviteLink.dto';

async function validateBody(body: Record<string, unknown>) {
    return validate(plainToInstance(CreateInviteLinkDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
    });
}

describe('CreateInviteLinkDto', () => {
    it('accepts empty, null and every allowed expiry', async () => {
        expect(await validateBody({})).toHaveLength(0);
        expect(await validateBody({ expiresInSeconds: null })).toHaveLength(0);
        for (const expiresInSeconds of [
            3600, 86_400, 604_800, 2_592_000,
        ]) {
            expect(await validateBody({ expiresInSeconds })).toHaveLength(0);
        }
    });

    it('accepts null and every allowed usage limit', async () => {
        expect(await validateBody({ maxUses: null })).toHaveLength(0);
        for (const maxUses of [1, 5, 10, 50, 100]) {
            expect(await validateBody({ maxUses })).toHaveLength(0);
        }
    });

    it('rejects any other expiry', async () => {
        for (const expiresInSeconds of [0, 1, 7200, -3600, '3600']) {
            expect(
                (await validateBody({ expiresInSeconds })).length,
            ).toBeGreaterThan(0);
        }
    });

    it('rejects any other usage limit', async () => {
        for (const maxUses of [0, 2, 11, 1000, '5']) {
            expect(
                (await validateBody({ maxUses })).length,
            ).toBeGreaterThan(0);
        }
    });
});
