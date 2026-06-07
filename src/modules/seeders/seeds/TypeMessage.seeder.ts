import { DataSource } from 'typeorm';
import { Seeder } from '../seeder.base';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { TypeMessage } from 'src/modules/messages/entities/typeMessage.entity';

const TypeMessages = [
    {
        name: TypeMessageEnum.FILE,
    },
    {
        name: TypeMessageEnum.ICE,
    },
    {
        name: TypeMessageEnum.IMAGE,
    },
    {
        name: TypeMessageEnum.TEXT,
    },
    {
        name: TypeMessageEnum.VIDEO,
    },
    {
        name: TypeMessageEnum.VOICE,
    },
];

export class TypeMessageSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }) {
        const TypeMessageRepository =
            this.dataSource.getRepository(TypeMessage);

        if (options?.onlyIfEmpty) {
            console.log('TypeMessageSeeder skipped: Data already exists.');
            return;
        }

        console.log('Running TypeMessageSeeder...');

        await TypeMessageRepository.upsert(TypeMessages, {
            conflictPaths: ['name'],
        });

        console.log('TypeMessageSeeder finished.');
    }
}
