import { Injectable } from "@nestjs/common";
import { ContentHandler } from "../interfaces/ContentHandler.interface";
import { TypeMessageEnum } from "src/common/enums/typeMessage.enum";
import * as fs from 'node:fs/promises';

@Injectable()
export class FileContentHandler implements ContentHandler {
    private readonly types = [
        TypeMessageEnum.IMAGE,
        TypeMessageEnum.FILE,
        TypeMessageEnum.VIDEO,
    ];

    supports(type: TypeMessageEnum) {
        return this.types.includes(type);
    }

    async resolve(content: string, type: TypeMessageEnum) {
        const dir = `./uploads/messages/${type}s`;
        const name = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(`${dir}/${name}`, Buffer.from(content, 'base64'));

        return `/uploads/messages/${type}s/${name}`;
    }
}