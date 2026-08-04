/** Standalone sweeper: `E2E_ALLOW_LIVE=1 npm run e2e:sweep`
 *
 * Removes every leaked e2e artifact from the live Supabase project. Use it after a
 * run that crashed, was interrupted, or reported a teardown failure — and as the
 * confirmation step the plan asks for after any e2e run.
 *
 * Defaults to a 30-minute age guard so it cannot delete a currently-running CI
 * suite's fixtures. Pass --all to ignore that.
 */

import { config as loadEnv } from 'dotenv';
import { createServiceClientFromEnv, requireLiveOptIn, sweepE2EArtifacts } from './fixtures';

async function main(): Promise<void> {
  loadEnv();
  requireLiveOptIn();

  const sweepAll = process.argv.includes('--all');
  const minAgeMinutes = sweepAll ? 0 : 30;

  console.log(
    sweepAll
      ? '[sweep] removing ALL e2e artifacts (no age guard)'
      : `[sweep] removing e2e artifacts older than ${minAgeMinutes} minutes`,
  );

  const supabase = createServiceClientFromEnv();
  const { swept, problems } = await sweepE2EArtifacts(supabase, { minAgeMinutes });

  console.log(`[sweep] removed ${swept} test user(s) and their rows`);

  if (problems.length > 0) {
    console.error(`[sweep] problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  if (swept === 0) {
    console.log('[sweep] nothing to clean up');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
