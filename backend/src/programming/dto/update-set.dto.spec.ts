import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { UpdateSetDto } from './update-set.dto';
import { MAX_PLAUSIBLE_LOAD_KG } from '../service/e1rm';

/** Logging what was actually lifted, validated through a real ValidationPipe
 * configured exactly as `main.ts` registers it globally.
 *
 * ⚠️ These fields were bounded below and not above. #36 stopped an implausible
 * load *propagating into a derived max*, but the set still stored it and history
 * still displayed it as though it happened. This is the root fix.
 */
describe('UpdateSetDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateSetDto, data: '' };
  const parse = (body: Record<string, unknown>) => pipe.transform(body, metadata);

  it('accepts a plausible logged set', async () => {
    await expect(parse({ actual_load: 140, actual_intensity: 8 })).resolves.toMatchObject({
      actual_load: 140,
      actual_intensity: 8,
    });
  });

  /** The typo that used to travel: 1000 instead of 100. */
  it('rejects a load above the plausible ceiling', async () => {
    await expect(parse({ actual_load: MAX_PLAUSIBLE_LOAD_KG + 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a load exactly at the ceiling', async () => {
    await expect(parse({ actual_load: MAX_PLAUSIBLE_LOAD_KG })).resolves.toMatchObject({
      actual_load: MAX_PLAUSIBLE_LOAD_KG,
    });
  });

  /** ⚠️ RPE is 1-10. The DTO previously accepted 0 and 47, which `e1rm.ts` then
   * silently refused to estimate from — so the value was stored, rendered in
   * history as "@0", and contributed nothing, for reasons invisible from the
   * screen. The rejection now happens where the user can still fix it. */
  it('rejects an RPE outside the 1-10 scale', async () => {
    await expect(parse({ actual_intensity: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ actual_intensity: 11 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts both ends of the RPE scale', async () => {
    await expect(parse({ actual_intensity: 1 })).resolves.toMatchObject({ actual_intensity: 1 });
    await expect(parse({ actual_intensity: 10 })).resolves.toMatchObject({
      actual_intensity: 10,
    });
  });

  /** Half-point RPE is real and widely used. The bounds must not quietly forbid
   * it by implying integers. */
  it('accepts a half-point RPE', async () => {
    await expect(parse({ actual_intensity: 8.5 })).resolves.toMatchObject({
      actual_intensity: 8.5,
    });
  });

  /** ⚠️ null still clears the field, and must survive the tightening. `ValidateIf`
   * is what lets an explicit null past `IsNumber`, and the new bounds must not
   * catch it on the way. */
  it('still accepts an explicit null to clear a value', async () => {
    await expect(parse({ actual_load: null, actual_intensity: null })).resolves.toMatchObject({
      actual_load: null,
      actual_intensity: null,
    });
  });

  it('still accepts a partial body', async () => {
    await expect(parse({ is_completed: true })).resolves.toMatchObject({ is_completed: true });
  });

  it('still rejects a negative load', async () => {
    await expect(parse({ actual_load: -5 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
