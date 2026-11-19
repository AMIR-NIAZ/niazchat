import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsInt,
    Min,
} from 'class-validator';
import { MAX_ADD_MEMBERS_PER_REQUEST } from '../utils/group-add-members.util';

/**
 * `POST /chats/:chatId/members`. One bounded batch of user ids; the service
 * re-validates and deduplicates before any write.
 */
export class AddGroupMembersDto {
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_ADD_MEMBERS_PER_REQUEST)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    userIds: number[];
}
