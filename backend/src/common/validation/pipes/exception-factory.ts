// exceptions/validation-exception-factory.ts
import { ValidationError } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { VALIDATION_EXCEPTION_MAPPINGS } from './exception-mappings';

/** This exception factory acts as a validation pipe for DTO validation errors.
 * Validation errors are passed to the exception factory, and the factory returns an
 * appropriate exception depending on the validation constraint.
 *
 * @param errors An array containing all errors that occured during validation.
 * @returns An exception that is appropriate for the first validation error.
 */
export const validationExceptionFactory = (errors: ValidationError[]) => {
  const firstError = errors[0];
  const property = firstError.property;
  const constraints = firstError.constraints || {};

  const constraintKey = Object.keys(constraints)[0];
  if (!constraintKey) {
    return new BadRequestException(`Validation failed for ${property}`);
  }

  const constraintMessage = constraints[constraintKey];
  const errorKey = `${property}.${constraintKey}`;

  // 1. First try property-specific mapping
  const propertySpecificMapping =
    VALIDATION_EXCEPTION_MAPPINGS[
      errorKey as keyof typeof VALIDATION_EXCEPTION_MAPPINGS
    ];
  if (propertySpecificMapping) {
    return propertySpecificMapping(property);
  }

  // 2. Then try generic constraint mapping
  const genericMapping =
    VALIDATION_EXCEPTION_MAPPINGS[
      constraintKey as keyof typeof VALIDATION_EXCEPTION_MAPPINGS
    ];
  if (genericMapping) {
    return genericMapping(property);
  }

  // 3. Final fallback with the original constraint message
  return new BadRequestException(
    `Validation failed for ${property}: ${constraintMessage}`,
  );
};
