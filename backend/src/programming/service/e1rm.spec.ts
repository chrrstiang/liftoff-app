import {
  MAX_PLAUSIBLE_LOAD_KG,
  MAX_WINDOW_DAYS,
  effectiveMax,
  estimateOneRepMax,
  resolvePrescribedLoad,
  selectMaxEstimate,
  type LoggedSet,
} from './e1rm';

/** The numeric core of derived maxes. Pure functions, so these are direct tests
 * rather than service tests through a mocked database — which matters, because a
 * wrong estimate here is not a crash. It is a plausible-looking number that every
 * athlete then gets programmed against.
 */
describe('estimateOneRepMax', () => {
  /** RPE 8 on a triple is five reps to failure: 3 + (10 - 8). Epley then gives
   * 100 * (1 + 5/30) = 116.67. Worked by hand so the test pins the formula rather
   * than whatever the implementation happens to return. */
  it('converts RPE to reps-in-reserve before applying Epley', () => {
    expect(estimateOneRepMax(100, 3, 8)).toBeCloseTo(116.667, 2);
  });

  it('treats RPE 10 as a true set to failure', () => {
    // 1 rep at RPE 10 is a true single: 100 * (1 + 1/30).
    expect(estimateOneRepMax(100, 1, 10)).toBeCloseTo(103.333, 2);
  });

  /** The domain fact the whole feature rests on: the same load and reps at a lower
   * RPE implies a higher max, because more was left in the tank. */
  it('estimates a higher max from an easier set at the same load', () => {
    const hard = estimateOneRepMax(150, 5, 9)!;
    const easy = estimateOneRepMax(150, 5, 6)!;

    expect(easy).toBeGreaterThan(hard);
  });

  /** ⚠️ The most important exclusion in the file. `actual_intensity` is nullable
   * and plenty of sets will never carry one. Treating a set with no RPE as taken
   * to failure would inflate every max in the app. */
  it('refuses to estimate from a set with no logged RPE', () => {
    expect(estimateOneRepMax(180, 5, null)).toBeNull();
  });

  it('refuses to estimate without a load or reps', () => {
    expect(estimateOneRepMax(null, 5, 8)).toBeNull();
    expect(estimateOneRepMax(180, null, 8)).toBeNull();
  });

  /** A prescribed set that was never performed has reps but no load. */
  it('refuses a zero or negative load', () => {
    expect(estimateOneRepMax(0, 5, 8)).toBeNull();
    expect(estimateOneRepMax(-10, 5, 8)).toBeNull();
  });

  it('refuses zero reps, which is a set that did not happen', () => {
    expect(estimateOneRepMax(180, 0, 8)).toBeNull();
  });

  /** An RPE outside 1-10 is a data-entry error, not a very easy set. Estimating
   * from it would produce a number that looks authoritative and is not: RPE 0
   * would imply ten reps in reserve. */
  it('refuses an RPE outside the 1-10 scale', () => {
    expect(estimateOneRepMax(180, 3, 0)).toBeNull();
    expect(estimateOneRepMax(180, 3, 11)).toBeNull();
    expect(estimateOneRepMax(180, 3, -5)).toBeNull();
  });

  /** ⚠️ **The typo that travels.** `UpdateSetDto` bounds `actual_load` at `Min(0)`
   * with no ceiling, so an athlete meaning 100kg who types 1000 logs it happily.
   * Before derived maxes that was one wrong row; now it would become this
   * exercise's max and then every future percentage prescribed against it. */
  it('refuses a load above the plausible ceiling, so a typo cannot become a max', () => {
    expect(estimateOneRepMax(MAX_PLAUSIBLE_LOAD_KG + 1, 3, 8)).toBeNull();
    expect(estimateOneRepMax(MAX_PLAUSIBLE_LOAD_KG, 3, 8)).not.toBeNull();
  });

  it('refuses non-finite input rather than returning NaN', () => {
    expect(estimateOneRepMax(Number.NaN, 3, 8)).toBeNull();
    expect(estimateOneRepMax(180, 3, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('selectMaxEstimate', () => {
  const NOW = new Date('2026-09-22T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  const set = (over: Partial<LoggedSet> & { id: string }): LoggedSet => ({
    actual_load: 100,
    prescribed_reps: 3,
    actual_intensity: 8,
    created_at: daysAgo(1),
    ...over,
  });

  /** ⚠️ Highest, not most recent — and this is the assertion that pins why. A max
   * is a capability. Taking the latest set would drop the max after every deload,
   * so the athlete would be prescribed lighter work *because* they had a light
   * week, which compounds into a spiral. */
  it('picks the highest estimate, not the most recent set', () => {
    const result = selectMaxEstimate(
      [
        set({ id: 'heavy', actual_load: 180, created_at: daysAgo(10) }),
        set({ id: 'deload', actual_load: 90, created_at: daysAgo(1) }),
      ],
      NOW,
    );

    expect(result).toEqual({ value: expect.any(Number), fromSetId: 'heavy' });
  });

  it('reports which set produced the number', () => {
    const result = selectMaxEstimate([set({ id: 'the-one', actual_load: 200 })], NOW);

    expect(result!.fromSetId).toBe('the-one');
    expect(result!.value).toBeCloseTo(estimateOneRepMax(200, 3, 8)!, 5);
  });

  /** Otherwise a personal best from a year ago would keep every future block
   * anchored to a number the athlete can no longer hit. */
  it('ignores sets older than the window', () => {
    const result = selectMaxEstimate(
      [set({ id: 'ancient', actual_load: 300, created_at: daysAgo(MAX_WINDOW_DAYS + 1) })],
      NOW,
    );

    expect(result).toBeNull();
  });

  it('includes a set on the window boundary', () => {
    const result = selectMaxEstimate(
      [set({ id: 'edge', created_at: daysAgo(MAX_WINDOW_DAYS - 1) })],
      NOW,
    );

    expect(result).not.toBeNull();
  });

  it('skips an implausible load and falls back to a real one', () => {
    const result = selectMaxEstimate(
      [set({ id: 'typo', actual_load: 1000000 }), set({ id: 'real', actual_load: 150 })],
      NOW,
    );

    expect(result!.fromSetId).toBe('real');
  });

  it('skips sets it cannot estimate from rather than failing', () => {
    const result = selectMaxEstimate(
      [
        set({ id: 'no-rpe', actual_load: 300, actual_intensity: null }),
        set({ id: 'usable', actual_load: 100 }),
      ],
      NOW,
    );

    expect(result!.fromSetId).toBe('usable');
  });

  /** The normal state for an exercise the athlete has not done RPE work on. Not an
   * error — the client renders "no max yet". */
  it('returns null when nothing in the window is usable', () => {
    expect(selectMaxEstimate([], NOW)).toBeNull();
    expect(selectMaxEstimate([set({ id: 'x', actual_intensity: null })], NOW)).toBeNull();
  });

  it('tolerates a string timestamp, which is what the driver returns', () => {
    const result = selectMaxEstimate(
      [set({ id: 'stringy', created_at: daysAgo(2).toISOString() })],
      NOW,
    );

    expect(result).not.toBeNull();
  });
});

describe('resolvePrescribedLoad', () => {
  it('resolves a percentage against the max', () => {
    expect(resolvePrescribedLoad(75, 200)).toBeCloseTo(150, 5);
  });

  /** ⚠️ Null, not zero and not an error. Prescribing percentages before the
   * athlete has logged anything is the normal first block; the client renders
   * "75% — no max yet". Returning 0 would put an empty barbell on the screen. */
  it('resolves to null when there is no max yet', () => {
    expect(resolvePrescribedLoad(75, null)).toBeNull();
  });

  it('resolves to null when no percentage was prescribed', () => {
    expect(resolvePrescribedLoad(null, 200)).toBeNull();
  });
});

describe('effectiveMax', () => {
  /** An override is a pin, not a seed: a coach who knows the athlete's comp squat
   * is 180 should not be overruled by one cautious session. */
  it('prefers the coach override over the computed value', () => {
    expect(effectiveMax({ override_value: 180, computed_value: 165 })).toBe(180);
  });

  it('falls back to the computed value when no override is pinned', () => {
    expect(effectiveMax({ override_value: null, computed_value: 165 })).toBe(165);
  });

  it('is null when neither exists', () => {
    expect(effectiveMax({ override_value: null, computed_value: null })).toBeNull();
  });

  /** `??` rather than `||`, so a deliberately pinned zero is not silently replaced
   * by a computed number. Zero is a strange max, but it is the coach's choice and
   * the precedence rule should not depend on truthiness. */
  it('treats a pinned zero as a real override', () => {
    expect(effectiveMax({ override_value: 0, computed_value: 165 })).toBe(0);
  });
});
