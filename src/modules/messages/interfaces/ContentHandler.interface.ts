import { TypeMessageEnum } from "src/common/enums/typeMessage.enum";

export interface ContentHandler {
    supports(type: TypeMessageEnum): boolean;
    resolve(content: string, type: TypeMessageEnum): Promise<string>;
}