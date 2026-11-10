import { PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { ROLE_KEY } from 'src/common/decorators/role.decorator';
import { ReactionController } from './reaction.controller';

const prototype = ReactionController.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
>;

describe('ReactionController access', () => {
    it('requires an admin to create a reaction type (no public route)', () => {
        expect(
            Reflect.getMetadata(PUBLIC_KEY, prototype.create),
        ).toBeUndefined();
        expect(Reflect.getMetadata(ROLE_KEY, prototype.create)).toEqual([
            'admin',
        ]);
    });

    it('keeps update/delete admin-only and the catalog readable by any user', () => {
        expect(Reflect.getMetadata(ROLE_KEY, prototype.update)).toEqual([
            'admin',
        ]);
        expect(Reflect.getMetadata(ROLE_KEY, prototype.delete)).toEqual([
            'admin',
        ]);
        expect(Reflect.getMetadata(ROLE_KEY, prototype.getAll)).toEqual([
            'all',
        ]);
    });
});
