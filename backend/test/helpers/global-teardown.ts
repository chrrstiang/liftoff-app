/** Jest globalTeardown for the e2e suite.
 *
 * The reason this exists rather than relying on afterEach/afterAll: those cannot
 * clean up a run that crashed, was killed, or failed inside its own fixture. Every
 * leaked auth user and orphaned athletes/coaches row before this was permanent,
 * manual cleanup — in the same database real users are in.
 *
 * Sweeps by email prefix, so it also collects debris left by earlier runs.
 */

import { config as loadEnv } from 'dotenv';
import { createServiceClientFromEnv, runId, sweepE2EArtifacts } from './fixtures';

export default async function globalTeardown(): Promise<void> {
  loadEnv();

  if (process.env.E2E_ALLOW_LIVE !== '1') return;

  try {
    const supabase = createServiceClientFromEnv();

    // minAgeMinutes: 0 is correct here -- test:e2e is --runInBand, so there is no
    // concurrent suite whose fixtures could be destroyed mid-run. The age guard is
    // for the standalone sweeper, which may run while CI is going.
    const { swept, problems } = await sweepE2EArtifacts(supabase, { minAgeMinutes: 0 });

    if (swept > 0) {
      console.log(`\n[e2e] swept ${swept} test user(s) (run ${runId()})`);
    }

    if (problems.length > 0) {
      console.error(`[e2e] sweep reported problems:\n  ${problems.join('\n  ')}`);
    }
  } catch (error) {
    // Never fail the run on teardown -- that would mask the real test result. Loud
    // enough to notice, since a silent failure here is how leaks accumulate.
    console.error(
      `[e2e] TEARDOWN FAILED — artifacts may have leaked into the live project. ` +
        `Run \`E2E_ALLOW_LIVE=1 npm run e2e:sweep\`.\n`,
      error,
    );
  }
}
