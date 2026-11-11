import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
    GROUP_DESCRIPTION_MAX_LENGTH,
    GROUP_TITLE_MAX_LENGTH,
    sanitizeGroupDescription,
    sanitizeGroupTitle,
    UpdateGroupInfoDto,
} from './updateGroupInfo.dto';

async function validateBody(body: Record<string, unknown>) {
    const instance = plainToInstance(UpdateGroupInfoDto, body);
    const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
    });
    return { instance, errors };
}

describe('group info sanitizing', () => {
    it('trims and collapses line breaks/whitespace in the title', () => {
        expect(sanitizeGroupTitle('  Team \n\n release  ')).toBe(
            'Team release',
        );
    });

    it('strips control characters from title and description', () => {
        expect(sanitizeGroupTitle('A\u0000B\tC')).toBe('A B C');
        expect(sanitizeGroupDescription('Line\u0000 one\nLine two')).toBe(
            'Line one\nLine two',
        );
    });

    it('clears an empty description to null', () => {
        expect(sanitizeGroupDescription('   ')).toBeNull();
        expect(sanitizeGroupDescription(null)).toBeNull();
        expect(sanitizeGroupDescription('  hello  ')).toBe('hello');
    });
});

describe('UpdateGroupInfoDto', () => {
    it('accepts a title only and sanitizes it', async () => {
        const { instance, errors } = await validateBody({
            title: '  Team \n release ',
        });
        expect(errors).toHaveLength(0);
        expect(instance.title).toBe('Team release');
    });

    it('accepts a description only, including null to clear it', async () => {
        const first = await validateBody({ description: '  hello ' });
        expect(first.errors).toHaveLength(0);
        expect(first.instance.description).toBe('hello');

        const second = await validateBody({ description: null });
        expect(second.errors).toHaveLength(0);
        expect(second.instance.description).toBeNull();
    });

    it('rejects an empty title after trimming', async () => {
        const { errors } = await validateBody({ title: '   \n  ' });
        expect(errors).toHaveLength(1);
    });

    it(`rejects a ${GROUP_TITLE_MAX_LENGTH + 1}-character title`, async () => {
        const { errors } = await validateBody({
            title: 'x'.repeat(GROUP_TITLE_MAX_LENGTH + 1),
        });
        expect(errors).toHaveLength(1);
    });

    it(`rejects a ${GROUP_DESCRIPTION_MAX_LENGTH + 1}-character description`, async () => {
        const { errors } = await validateBody({
            description: 'x'.repeat(GROUP_DESCRIPTION_MAX_LENGTH + 1),
        });
        expect(errors).toHaveLength(1);
    });

    it('accepts the maximum lengths', async () => {
        const { errors } = await validateBody({
            title: 'x'.repeat(GROUP_TITLE_MAX_LENGTH),
            description: 'y'.repeat(GROUP_DESCRIPTION_MAX_LENGTH),
        });
        expect(errors).toHaveLength(0);
    });

    it('rejects unknown fields', async () => {
        const { errors } = await validateBody({ title: 'Team', isBan: true });
        expect(errors).toHaveLength(1);
    });

    it('rejects a non-string title', async () => {
        const { errors } = await validateBody({ title: 42 });
        expect(errors.length).toBeGreaterThan(0);
    });
});
