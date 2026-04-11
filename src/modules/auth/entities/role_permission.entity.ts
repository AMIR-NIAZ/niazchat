import { BaseEntity } from "src/common/entities/base.entity";
import { Entity, ManyToOne } from "typeorm";
import { Permission } from "./permission.entity";
import { Role } from "./role.entity";

@Entity('role_permissions')
export class RolePermission extends BaseEntity {
    @ManyToOne(() => Permission, permission => permission.roles)
    permission: Permission;

    @ManyToOne(() => Role, role => role.rolePermissions)
    role: Role;
}