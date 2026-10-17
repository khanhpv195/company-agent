import { ClockService } from '../../src/common/clock';

/** Real time plus a movable offset, so tests advance time instead of sleeping. */
export class TestClock extends ClockService {
  private offsetMs = 0;

  override now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }
}
