import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { ROLE_KEY } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';

@Injectable()
export class RoleGurd implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const publicMethod: boolean = this.reflector.get(
            PUBLIC_KEY,
            context.getHandler(),
        );
        if (publicMethod) return true;

        const userRole: string = context.switchToHttp().getRequest().user?.role;
        const requiredRoles: string[] =
            this.reflector.get(ROLE_KEY, context.getHandler()) || [];

        if (userRole == RoleEnum.OWNER) return true;
        if (requiredRoles.includes(RoleEnum.ALL)) return true;

        return requiredRoles.includes(userRole);
    }
}
