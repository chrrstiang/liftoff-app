/** Jest globalSetup for the e2e suite.
 *
 * Runs once per `npm run test:e2e`, before any spec. Two jobs: refuse to run
 * without an explicit live-database opt-in, and stamp one run id that every
 * fixture in the run shares.
 *
 * Note: this runs outside the Nest harness, so ConfigModule has not loaded .env
 * yet. dotenv is pulled in transitively by @nestjs/config rather than declared
 * directly, to avoid adding a dependency for test tooling alone.
 */

import { config as loadEnv } from 'dotenv';
import { requireLiveOptIn, runId } from './fixtures';

export default function globalSetup(): void {
  loadEnv();

  requireLiveOptIn();

  // Seed it here so all specs in the run share one id. Assigning to process.env is
  // how it reaches the workers; the helper regenerates per-process if that ever
  // fails, and the sweeper keys off the stable `e2e-` prefix either way.
  const id = runId();

  console.log(
    `\n[e2e] run id ${id} — artifacts are prefixed e2e-${id} / e2e_${id}\n` +
      `[e2e] ⚠️  writing to the LIVE Supabase project\n`,
  );
}
