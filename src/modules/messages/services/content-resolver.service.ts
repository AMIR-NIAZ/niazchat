import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { ContentHandler } from '../interfaces/ContentHandler.interface';

export const CONTENT_HANDLERS = 'CONTENT_HANDLERS';

@Injectable()
export class ContentResolverService {
    constructor(
        @Inject(CONTENT_HANDLERS)
        private readonly handlers: ContentHandler[],
    ) {}

    async resolve(
        content: string,
        type: TypeMessageEnum,
    ): Promise<string> {
        const handler = this.handlers.find((handler) =>
            handler.supports(type),
        );

        if (!handler) {
            throw new BadRequestException(
                `Unsupported message type: ${type}`,
            );
        }

        return handler.resolve(content, type);
    }
}
