import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import {
  DEFAULT_HISTORY_LIMIT,
  HistoryQueryDto,
  MAX_HISTORY_LIMIT,
  resolveHistoryWindow,
} from './history-query.dto';

/** The history query string — validated through a real ValidationPipe.
 *
 * Configured with exactly the options `main.ts` registers globally. Asserting
 * against `class-validator`'s `validate()` directly would skip
 * `forbidNonWhitelisted` and the `@Type` conversion, which are two of the three
 * things this DTO exists for — and query parameters arrive as **strings**, so a
 * spec that passes numbers in would prove nothing about the real request.
 */
describe('HistoryQueryDto', () => {
  const ATHLETE = '22222222-2222-4222-8222-222222222222';

  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const metadata: ArgumentMetadata = { type: 'query', metatype: HistoryQueryDto, data: '' };

  const parse = (query: Record<string, string>): Promise<HistoryQueryDto> =>
    pipe.transform(query, metadata) as Promise<HistoryQueryDto>;

  it('accepts athlete_id on its own', async () => {
    const parsed = await parse({ athlete_id: ATHLETE });

    expect(parsed.athlete_id).toBe(ATHLETE);
    expect(parsed.limit).toBeUndefined();
    expect(parsed.offset).toBeUndefined();
  });

  /** Query parameters are strings. Without `@Type(() => Number)` these reach the
   * service as `'10'`, and `Math.min('10', 50)` is not a type error in this
   * package — `noImplicitAny` is off and the comparison coerces. */
  it('converts limit and offset to numbers', async () => {
    const parsed = await parse({ athlete_id: ATHLETE, limit: '10', offset: '40' });

    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(40);
  });

  it('rejects a limit above the cap', async () => {
    await expect(
      parse({ athlete_id: ATHLETE, limit: String(MAX_HISTORY_LIMIT + 1) }),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    ['a limit of zero', { limit: '0' }],
    ['a negative offset', { offset: '-1' }],
    ['a non-numeric limit', { limit: 'all' }],
    ['a fractional limit', { limit: '2.5' }],
  ])('rejects %s', async (_case, overrides) => {
    await expect(parse({ athlete_id: ATHLETE, ...overrides })).rejects.toThrow(BadRequestException);
  });

  it('rejects a malformed athlete_id rather than passing it to SQL', async () => {
    await expect(parse({ athlete_id: 'not-a-uuid' })).rejects.toThrow(BadRequestException);
  });

  it('requires athlete_id — an absent one does not mean "everybody"', async () => {
    await expect(parse({})).rejects.toThrow(BadRequestException);
  });

  /** `forbidNonWhitelisted` covers query parameters too. A typo'd `?limt=5` is a
   * 400 rather than a silently-default page, and adding a parameter to these routes
   * means adding it to this DTO. */
  it('rejects an unknown parameter', async () => {
    await expect(parse({ athlete_id: ATHLETE, limt: '5' })).rejects.toThrow(BadRequestException);
  });

  it('accepts a date-only before', async () => {
    const parsed = await parse({ athlete_id: ATHLETE, before: '2026-09-17' });

    expect(parsed.before).toBe('2026-09-17');
  });

  it.each([
    ['a timestamp', '2026-09-17T10:00:00Z'],
    ['a month that does not exist', '2026-13-01'],
    ['a day that does not exist in that month', '2026-02-31'],
    ['a two-digit year', '26-09-17'],
    ['prose', 'last week'],
  ])('rejects %s as before', async (_case, before) => {
    await expect(parse({ athlete_id: ATHLETE, before })).rejects.toThrow(BadRequestException);
  });

  describe('resolveHistoryWindow', () => {
    it('defaults to the standard page starting at zero', () => {
      const window = resolveHistoryWindow({ athlete_id: ATHLETE });

      expect(window.limit).toBe(DEFAULT_HISTORY_LIMIT);
      expect(window.offset).toBe(0);
    });

    it('defaults before to today, so a history route never returns the future', () => {
      const window = resolveHistoryWindow({ athlete_id: ATHLETE });

      expect(window.before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(window.before).toBe(new Date().toISOString().slice(0, 10));
    });

    it('passes a supplied before through untouched', () => {
      expect(resolveHistoryWindow({ athlete_id: ATHLETE, before: '2026-01-02' }).before).toBe(
        '2026-01-02',
      );
    });

    /** The cap is applied here as well as in the DTO. The DTO only runs on a real
     * HTTP request, and this is the boundary that actually reaches SQL. */
    it('clamps a limit that got past validation', () => {
      expect(resolveHistoryWindow({ athlete_id: ATHLETE, limit: 5000 }).limit).toBe(
        MAX_HISTORY_LIMIT,
      );
    });
  });
});
