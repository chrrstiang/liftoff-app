import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

/** This constant will contain mappings for validation constraints to specific exceptions. It will allow
 * the exception factory to decide which exception to return based on the validation error constraints.
 *
 */
export const VALIDATION_EXCEPTION_MAPPINGS = {
  // Property-specific mappings (property.constraint)
  'email.isEmail': () =>
    new UnprocessableEntityException('Please provide a valid email address'),
  'email.isNotEmpty': () =>
    new BadRequestException('Email address is required'),
  'password.minLength': () =>
    new UnprocessableEntityException(
      'Password must be at least 8 characters long',
    ),
  'password.matches': () =>
    new UnprocessableEntityException(
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    ),
  'username.matches': () =>
    new BadRequestException(
      'Username can only contain letters, numbers, underscores and periods',
    ),
  'username.isLength': () =>
    new BadRequestException('Username must be between 3 and 20 characters'),
  'username.isUnique': () =>
    new BadRequestException('Username is already taken'),
  'username.isLowercase': () =>
    new BadRequestException('Username must be lowercase'),
  'age.min': () => new BadRequestException('Must be at least 18 years old'),
  'age.max': () => new BadRequestException('Age cannot exceed 120'),
  'phone.isMobilePhone': () =>
    new UnprocessableEntityException('Invalid phone number format'),

  // Generic constraint mappings (just the constraint name)
  isNotEmpty: (property: string) =>
    new BadRequestException(`${property} is required`),
  isEmail: () => new UnprocessableEntityException('Invalid email format'),
  minLength: (property: string) =>
    new UnprocessableEntityException(`${property} is too short`),
  maxLength: (property: string) =>
    new UnprocessableEntityException(`${property} is too long`),
  isString: (property: string) =>
    new BadRequestException(`${property} must be a string`),
  isNumber: (property: string) =>
    new BadRequestException(`${property} must be a number`),
  isBoolean: (property: string) =>
    new BadRequestException(`${property} must be a boolean`),
  isArray: (property: string) =>
    new BadRequestException(`${property} must be an array`),
  isDateString: () => new UnprocessableEntityException('Invalid date format'),
  isUUID: () => new UnprocessableEntityException('Invalid UUID format'),
  isEnum: (property: string) =>
    new BadRequestException(`${property} must be a valid option`),
  arrayMinSize: (property: string) =>
    new BadRequestException(`${property} must contain at least one item`),
  arrayMaxSize: (property: string) =>
    new BadRequestException(`${property} contains too many items`),
  valueExists: (property: string) =>
    new BadRequestException(`${property} does not exist`),
} as const;
