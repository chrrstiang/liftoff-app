import { BadRequestException } from "@nestjs/common";

export class NotUniqueException extends BadRequestException {
    constructor(column: string) {
        super(`value for ${column} already exists.`)
    }
}