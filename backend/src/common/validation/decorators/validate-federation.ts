import { registerDecorator, ValidationOptions } from "class-validator";
import { ValueExistsValidator } from "../validators/value-exists.validator";

export function ValueExists(
    tableName: string,
    column: string,
    validationOptions?: ValidationOptions) {
    return function(object: Object, propertyName: string) {
        registerDecorator({
            name: 'valueExists',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            constraints: [tableName, column],
            validator: ValueExistsValidator,
        })
    }
}