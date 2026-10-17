import { Injectable } from '@nestjs/common';

/** Single time source for domain logic, so tests can replace it and advance time. */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }
}
