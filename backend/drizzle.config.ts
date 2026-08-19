import type { Config } from 'drizzle-kit';

/** Drizzle Kit configuration.
 *
 * DATABASE_URL points at whatever you are targeting: a local Docker Postgres for
 * development and tests, or RDS. It is never the Supabase connection string —
 * Supabase keeps only auth now.
 */
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // The five views are managed as plain SQL in src/db/views.sql; Drizzle does not
  // model views, and without this it would try to drop things it does not know about.
  verbose: true,
  strict: true,
} satisfies Config;
