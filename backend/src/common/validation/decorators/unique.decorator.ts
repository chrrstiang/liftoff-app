import { registerDecorator, ValidationOptions } from "class-validator";
import { IsUniqueValidator } from "../validators/unique.validator";

export function IsUnique(
    tableName: string,
    column: string,
    validationOptions?: ValidationOptions) {
    return function(object: Object, propertyName: string) {
        registerDecorator({
            name: 'isUnique',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            constraints: [tableName, column],
            validator: IsUniqueValidator,
        })
    }
}