import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

/** A scriptable stand-in for the Drizzle client, for unit tests.
 *
 * Drizzle's builders are chainable *and* awaitable, and a query is issued when the
 * chain is awaited rather than by a terminal method — `.limit(1)` and a bare
 * `.where(...)` are both valid endings. A hand-written mock therefore has to accept
 * any method in any order and resolve whenever it is awaited, which is what the
 * proxy below does.
 *
 * **Results are keyed by table, not by call order.** The obvious alternative — a
 * flat queue of results consumed in sequence — makes every spec depend on the exact
 * order and number of queries the service happens to issue, so adding a validation
 * read silently shifts every later result onto the wrong statement and the failure
 * appears somewhere unrelated. Keying by table survives reordering.
 *
 * Each table maps to a *list* of results, so a service that queries the same table
 * twice (a read then an insert) can return different rows each time. Running out of
 * scripted results yields `[]`, which is what "no rows matched" looks like.
 */
export interface DbScript {
  [tableName: string]: unknown[][];
}

/** A query builder. Every property is callable and returns another builder, and
 * awaiting one resolves the scripted rows — which is the shape Drizzle's builders
 * present, minus the type safety.
 *
 * Typed as `unknown`-valued rather than `any`-valued on purpose: an `any` here
 * spreads through every `return` in the proxy handler and trips
 * `no-unsafe-return`, which is an error in this package.
 */
type Builder = Record<string | symbol, unknown>;

export interface TestDb {
  /** Pass straight to `{ provide: DRIZZLE, useValue: harness.db }`. */
  db: Builder;
  /** Every table an insert/update/delete was issued against, in order. */
  writes: Array<{ op: 'insert' | 'update' | 'delete'; table: string; values?: unknown }>;
  /** How many times a transaction callback has been entered. */
  transactions: number;
}

function tableName(value: unknown): string | null {
  return is(value, PgTable) ? getTableName(value) : null;
}

export function makeTestDb(script: DbScript = {}): TestDb {
  const queues: Record<string, unknown[][]> = {};
  for (const [name, results] of Object.entries(script)) {
    queues[name] = results.map((r) => r);
  }

  const writes: TestDb['writes'] = [];
  const state = { transactions: 0 };

  const take = (name: string | null): unknown[] => {
    if (!name) return [];
    const queue = queues[name];
    return queue && queue.length ? queue.shift()! : [];
  };

  /** One builder chain. `ref.table` is filled in by whichever call names a table. */
  function chain(initial: string | null, onValues?: (values: unknown) => void): Builder {
    const ref = { table: initial };

    const proxy: Builder = new Proxy({} as Builder, {
      get(_target, prop): unknown {
        // Awaiting the chain is what issues the query.
        if (prop === 'then') {
          const rows = take(ref.table);
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject);
        }

        // Present so `await`ing a chain that throws behaves sanely.
        if (prop === 'catch' || prop === 'finally') {
          return (): Builder => proxy;
        }

        return (...args: unknown[]): Builder => {
          // `from` names the table being read. `innerJoin`/`leftJoin` deliberately
          // do not: a joined read is keyed by the table it starts from, which is
          // the one the service is conceptually querying.
          if (prop === 'from') {
            const name = tableName(args[0]);
            if (name) ref.table = name;
          }

          if (prop === 'values' && onValues) onValues(args[0]);

          return proxy;
        };
      },
    });

    return proxy;
  }

  const client: Builder = {
    select: (): Builder => chain(null),

    insert: (table: unknown): Builder => {
      const name = tableName(table);
      return chain(name, (values) => {
        writes.push({ op: 'insert', table: name ?? '?', values });
      });
    },

    update: (table: unknown): Builder => {
      const name = tableName(table);
      writes.push({ op: 'update', table: name ?? '?' });
      return chain(name);
    },

    delete: (table: unknown): Builder => {
      const name = tableName(table);
      writes.push({ op: 'delete', table: name ?? '?' });
      return chain(name);
    },

    /** Runs the callback immediately against the same client.
     *
     * That means these specs verify *what* the service writes, not that a rollback
     * happens — a real transaction cannot be observed without a real database.
     * Rollback behaviour is covered by the e2e suite against Postgres.
     */
    transaction: async (callback: (tx: Builder) => Promise<unknown>): Promise<unknown> => {
      state.transactions += 1;
      return callback(client);
    },
  };

  return {
    db: client,
    writes,
    get transactions() {
      return state.transactions;
    },
  };
}
