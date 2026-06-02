import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { IsPublic } from 'src/common/decorators/public.decorator';
import { PhoneDto } from '../dtos/phone.dto';
import { VerifyDto } from '../dtos/verify.dto';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { IsBanPhone } from 'src/common/guards/restGuards/IsBanPhone.guard';
import { PermissionsDto } from '../dtos/permission.dto';
import { PermissionService } from '../services/permission.service';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly permissionService: PermissionService,
    ) {}

    @Post('send-otp')
    @UseGuards(IsBanPhone)
    @IsPublic()
    async sendOtp(@Body() dto: PhoneDto) {
        return await this.authService.register(dto);
    }

    @Post('verify-otp')
    @IsPublic()
    async verifyOtp(@Body() dto: VerifyDto) {
        return await this.authService.verifyUserByOtp(dto);
    }

    @Post('refresh-token')
    @IsPublic()
    async refreshToken(@Headers('token') token: string) {
        return await this.authService.refreshToken(token);
    }

    @Get('getme')
    @Role([RoleEnum.ALL])
    async getMe(@Req() req: RequestAuth) {
        return await this.authService.getme(req.user);
    }

    @Put('ban/:id')
    @Role([RoleEnum.ADMIN])
    async banUser(@Param('id') id: number) {
        await this.authService.banUser(id);
    }

    @Post('users/:userId/admin')
    @Role([RoleEnum.OWNER])
    async addAdmin(
        @Param('userId', ParseIntPipe) userId: number,
        @Body() dto: PermissionsDto,
    ) {
        return await this.permissionService.addAdmin(userId, dto);
    }

    @Delete('users/:userId/admin')
    @Role([RoleEnum.OWNER])
    async deleteAdmin(@Param('adminId', ParseIntPipe) adminId: number) {
        return await this.permissionService.deleteAdmin(adminId);
    }

    @Get('admins')
    @Role([RoleEnum.OWNER])
    async getAdmin() {
        return await this.permissionService.getAllAdmins();
    }

    @Put('admins/:adminId/permissions')
    @Role([RoleEnum.OWNER])
    async updateAdminPermissions(
        @Param('adminId', ParseIntPipe) adminId: number,
        @Body() dto: PermissionsDto,
    ) {
        return await this.permissionService.updateAdminPermissions(
            adminId,
            dto,
        );
    }

    @Get('admins/:adminId/permissions')
    @Role([RoleEnum.OWNER])
    async getPermissionsAdmin(@Param('adminId', ParseIntPipe) adminId: number) {
        return await this.permissionService.getAdminPermissions(adminId);
    }
}
