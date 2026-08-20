/** Applies the migration chain and reference-data seed to whatever database the
 * environment points at.
 *
 * Runs as a **one-off ECS task inside the VPC**, not from a laptop. RDS is
 * `--no-publicly-accessible` on purpose, and the alternative — temporarily
 * flipping public access and poking a hole in the security group — means putting
 * the database on the internet and handling the master password by hand. This way
 * the password arrives from Secrets Manager the same way the API gets it, and is
 * never seen by anyone.
 *
 * Idempotent. Drizzle records applied migrations in `drizzle.__drizzle_migrations`
 * and skips them; the seed is written as upserts.
 *
 *   Local:  npm run db:migrate:run
 *   RDS:    infra/README.md -> "Applying migrations to RDS"
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

function poolConfig() {
  const url = process.env.DATABASE_URL;
  if (url) return { connectionString: url };

  const host = process.env.PGHOST;
  if (!host) {
    throw new Error(
      'No database configuration. Set DATABASE_URL, or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.',
    );
  }

  return {
    host,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    // RDS requires TLS. Verifying the chain would mean bundling the RDS CA; the
    // connection is encrypted either way and never leaves the VPC.
    ssl: { rejectUnauthorized: false },
  };
}

async function main(): Promise<void> {
  const pool = new Pool({ ...poolConfig(), max: 2 });
  const db = drizzle(pool);

  const migrationsFolder = join(__dirname, 'migrations');
  console.log(`applying migrations from ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');

  const seedPath = join(__dirname, 'seed-reference-data.sql');
  console.log(`seeding reference data from ${seedPath} ...`);
  await pool.query(readFileSync(seedPath, 'utf8'));

  const { rows } = await pool.query<{ tables: string; views: string; feds: string }>(
    `select
       (select count(*) from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
       (select count(*) from information_schema.tables
         where table_schema = 'public' and table_type = 'VIEW') as views,
       (select count(*) from federations) as feds`,
  );

  const { tables, views, feds } = rows[0];
  console.log(`done: ${tables} tables, ${views} views, ${feds} federations`);

  // Fail loudly rather than reporting success on a half-applied schema.
  if (Number(tables) !== 18 || Number(views) !== 5 || Number(feds) === 0) {
    throw new Error(
      `unexpected final state: ${tables} tables, ${views} views, ${feds} federations`,
    );
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
