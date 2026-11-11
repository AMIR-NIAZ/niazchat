import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import {
    EDITABLE_ADMIN_PERMISSIONS,
    EditableAdminPermission,
} from '../utils/group-members.util';

/**
 * Body of `PUT /chats/:chatId/members/:memberId/permissions`.
 *
 * The global ValidationPipe rejects unknown properties, duplicates, more than
 * three entries, `all` (deliberately not editable) and unknown names. An empty
 * array is valid and removes every grant.
 */
export class UpdateMemberPermissionsDto {
    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(3)
    @IsIn([...EDITABLE_ADMIN_PERMISSIONS], { each: true })
    permissions: EditableAdminPermission[];
}
