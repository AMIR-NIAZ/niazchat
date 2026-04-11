import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Put,
    Req,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { UpdateUserDto } from '../dtos/updateUser.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UserService } from '../services/user.service';
import { RequestAuth } from 'src/common/types/RequestAuth.type';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Put('updateme')
    @Role([RoleEnum.ALL])
    async upadteMe(@Body() dto: UpdateUserDto, @Req() req: RequestAuth) {
        return await this.userService.updateUser(dto, req.user);
    }

    @Put('uploade-avatar')
    @Role([RoleEnum.ALL])
    @UseInterceptors(
        FileInterceptor('avatar', {
            storage: diskStorage({
                destination: './uploads/avatars',
                filename: (req, file, cb) => {
                    const uniqueName =
                        Date.now() + '-' + Math.round(Math.random() * 1e9);
                    cb(null, uniqueName + extname(file.originalname));
                },
            }),
        }),
    )
    async updateAvatar(
        @UploadedFile() file: Express.Multer.File,
        @Req() req: RequestAuth,
    ) {
        return await this.userService.uploadAvatar(file.path, req.user);
    }

    @Delete('delete-avatar')
    @Role([RoleEnum.ALL])
    async deleteAvatar(
        @Body('avatar') avatar: string,
        @Req() req: RequestAuth,
    ) {
        return await this.userService.deleteAvatar(avatar, req.user);
    }

    @Get('pv/:userName')
    @Role([RoleEnum.ALL])
    async getUserById(@Param('userName') userName: string) {
        return await this.userService.getUserByUsername(userName);
    }
}
