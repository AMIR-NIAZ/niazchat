import { DataSource } from 'typeorm';
import { Seeder } from '../seeder.base';
import { React } from 'src/modules/reactions/entities/react.entity';

/**
 * The allowlist of reaction types is the `reacts` table itself; these six are
 * the defaults. The seeder only inserts missing rows, so admin edits and
 * additional types survive every restart.
 */
export const REACTION_DEFAULTS: Array<Pick<React, 'name' | 'emoji'>> = [
    { name: 'thumbs_up', emoji: '👍' },
    { name: 'heart', emoji: '❤️' },
    { name: 'joy', emoji: '😂' },
    { name: 'open_mouth', emoji: '😮' },
    { name: 'cry', emoji: '😢' },
    { name: 'pray', emoji: '🙏' },
];

export class ReactSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(): Promise<void> {
        const repository = this.dataSource.getRepository(React);
        console.log('Running ReactSeeder...');

        for (const preset of REACTION_DEFAULTS) {
            const existing = await repository.findOne({
                where: [{ name: preset.name }, { emoji: preset.emoji }],
            });
            if (existing) {
                continue;
            }
            await repository.insert(preset);
        }

        console.log('ReactSeeder finished.');
    }
}
