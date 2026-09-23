import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { CreateWorkoutDto } from './create-workout.dto';

/** The `date` field on workout creation, validated through a real ValidationPipe
 * configured exactly as `main.ts` registers it globally.
 *
 * ⚠️ **What this exists to prevent.** `date` was a bare `@IsDateString()`, which
 * accepts a full timestamp — and the client sent one, via `toISOString()`.
 * `workouts.date` is a Postgres `date`, so the timestamp was truncated to the
 * **UTC** day: a coach in US Eastern writing at 9pm on the 5th had the session
 * stored on the 6th. Their own screen rendered `toLocaleDateString` and showed
 * the 5th, so nothing looked wrong at either end — the athlete just saw it on the
 * wrong day.
 *
 * The client stopped sending a timestamp in the same change. This is the half
 * that stops it coming back.
 */
describe('CreateWorkoutDto.date', () => {
  const EXERCISE = '44444444-4444-4444-8444-444444444444';
  const ATHLETE = '22222222-2222-4222-8222-222222222222';

  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const metadata: ArgumentMetadata = { type: 'body', metatype: CreateWorkoutDto, data: '' };

  const body = (date: unknown) => ({
    name: 'Squat day',
    date,
    athlete_id: ATHLETE,
    exercises: [{ exercise_id: EXERCISE, order: 0, sets: [{ set_number: 1, prescribed_reps: 5 }] }],
  });

  const parse = (date: unknown) => pipe.transform(body(date), metadata);

  it('accepts a date-only YYYY-MM-DD', async () => {
    await expect(parse('2026-10-05')).resolves.toMatchObject({ date: '2026-10-05' });
  });

  /** ⚠️ The regression guard. A timestamp must be refused outright rather than
   * silently reinterpreted in UTC. */
  it('rejects a full ISO timestamp', async () => {
    await expect(parse('2026-10-06T01:00:00.000Z')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a timestamp with an offset, which is the same trap wearing a hat', async () => {
    await expect(parse('2026-10-05T21:00:00-04:00')).rejects.toBeInstanceOf(BadRequestException);
  });

  /** Well-formed and impossible. Without `strict` this reaches Postgres and comes
   * back as a 500 rather than a 400. */
  it('rejects a well-shaped date that does not exist', async () => {
    await expect(parse('2026-02-31')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a date in the wrong order or with missing padding', async () => {
    await expect(parse('05-10-2026')).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse('2026-1-5')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing date', async () => {
    await expect(parse(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  /** A leap day is a real date and must survive the tightening. */
  it('accepts 29 February in a leap year', async () => {
    await expect(parse('2028-02-29')).resolves.toMatchObject({ date: '2028-02-29' });
  });
});
