/** All "now" reads go through a Clock so tests can move time without touching production code paths. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class TestClock implements Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
  advanceMinutes(min: number): void {
    this.advance(min * 60_000);
  }
  reset(): void {
    this.offsetMs = 0;
  }
  /** Jump to a specific instant (the clock keeps running from there). */
  set(d: Date): void {
    this.offsetMs = d.getTime() - Date.now();
  }
}

const IL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Business date (YYYY-MM-DD) in Israel time. */
export const israelDate = (d: Date): string => IL_DATE.format(d);
