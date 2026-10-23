import { Injectable } from "@nestjs/common";
import { TypeMessageEnum } from "src/common/enums/typeMessage.enum";
import { ContentHandler } from "../interfaces/ContentHandler.interface";

@Injectable()
export class TextContentHandler implements ContentHandler {
    supports(type: TypeMessageEnum) {
        return type === TypeMessageEnum.TEXT;
    }

    async resolve(content: string) {
        return content;
    }
}
