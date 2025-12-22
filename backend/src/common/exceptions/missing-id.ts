import { NotFoundException } from '@nestjs/common';

export class MissingIdException extends NotFoundException {
  constructor() {
    super('ID is unable to be found.');
  }
}
