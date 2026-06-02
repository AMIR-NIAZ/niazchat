import { IsEnum } from 'class-validator';
import { PermissionEnum } from 'src/common/enums/permission.enum';

export class PermissionsDto {
    @IsEnum(PermissionEnum, { each: true })
    permissions: PermissionEnum[];
}
