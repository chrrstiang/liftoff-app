import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/** Injection token for the Drizzle instance.
 *
 * A symbol rather than a string so it cannot collide with another provider:
 *   constructor(@Inject(DRIZZLE) private readonly db: Database) {}
 */
export const DRIZZLE = Symbol('DRIZZLE');

/** The typed Drizzle handle. Carrying the schema generic is what makes
 * `db.query.users.findFirst(...)` type-check against the real columns. */
export type Database = NodePgDatabase<typeof schema>;

const PG_POOL = Symbol('PG_POOL');

/** Two ways to configure the connection, and the split is deliberate.
 *
 * `DATABASE_URL` is the local/dev path -- one string, easy to paste, matches
 * what drizzle-kit reads.
 *
 * In ECS there is no URL, because RDS manages the master password itself and
 * stores it in Secrets Manager. Building a URL would mean interpolating that
 * secret somewhere, which is exactly what we are trying to avoid. Instead the
 * task definition injects PGPASSWORD straight from the secret and the rest as
 * plain environment, and node-postgres reads all of them natively.
 */
function poolConfigFromEnv(config: ConfigService) {
  const url = config.get<string>('DATABASE_URL');
  if (url) return { connectionString: url };

  const host = config.get<string>('PGHOST');
  if (!host) {
    throw new Error(
      'No database configuration found. Set DATABASE_URL (local: run `npm run db:up`), ' +
        'or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (how ECS injects it, with ' +
        'PGPASSWORD coming from the RDS-managed secret).',
    );
  }

  return {
    host,
    port: Number(config.get<string>('PGPORT') ?? 5432),
    user: config.get<string>('PGUSER'),
    password: config.get<string>('PGPASSWORD'),
    database: config.get<string>('PGDATABASE'),
    // RDS requires TLS. rejectUnauthorized stays false because verifying the
    // chain needs the RDS CA bundle baked into the image; the connection is
    // still encrypted, and it never leaves the VPC.
    ssl: { rejectUnauthorized: false },
  };
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          ...poolConfigFromEnv(config),
          // Deliberately small. Each Fargate task holds its own pool, so the real
          // ceiling is (tasks x max), and db.t4g.micro allows only ~85
          // connections. Sizing this like a single-server app is how you exhaust
          // the database during a deploy, when old and new tasks overlap.
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Without this the pool keeps the event loop alive, so Jest hangs after the
   * suite and SIGTERM during an ECS deploy waits out the stop timeout instead of
   * shutting down cleanly. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
