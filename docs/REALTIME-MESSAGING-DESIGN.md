# Real-time messaging — design

**Status: design only. None of this is built.** Drafted 2026-09-13. Messaging today is
HTTP polling (`frontend/lib/api/polling.ts`) and works; this describes what replacing it
would look like in production, plus read receipts and edit/unsend. Nothing here has been
implemented, no dependencies have been added, and no migration has been written.

**Revised 2026-09-22**, after an audit against the code it describes. What changed:

- **§5** — `seq` is no longer a `bigserial` (commit order, not allocation order), gains a
  companion `updated_seq` so replay can see edits and deletes, and now carries the backfill,
  index and installed-build work the first draft treated as a three-line change.
- **§4** — the publish moves *inside* the writing transaction, and the `LISTEN` connection is
  pulled out of the pool.
- **§6** — typing indicators get the lease/rate-limit rules that stop them sticking forever.
- **§7** — token expiry over a long-lived socket now has a mechanism instead of two options
  and no choice between them.
- **§8** — polling and the socket are made mutually exclusive rather than layered.
- **§11–12** — new: how this gets tested given CI skips e2e, and what it must not exceed.
- **§13** — new: the five decisions the audit surfaced, all five now answered. Read that first.

Still design only. Nothing here is built.

**Line references were re-resolved against `main` on 2026-09-23** and will drift again — the
backend moved ~50 lines between the audit and this revision. Where a citation matters, the
symbol name is given alongside it; trust the symbol over the number.

For the flows this builds on see `ARCHITECTURE.md`. For who-may-reach-what see
`AUTHORIZATION.md` — the rules there are load-bearing for section 3.

---

## 1. Where messaging is now

Supabase Realtime was dropped when data moved to RDS, and two screens that depended on it
— the inbox and the open thread — were converted to polling:

| Constant         | Value | Screen            |
| ---------------- | ----- | ----------------- |
| `THREAD_POLL_MS` | 5s    | open thread       |
| `INBOX_POLL_MS`  | 30s   | conversation list |

`polling.ts` already names its own replacement: _"the honest fix is a websocket or SSE
endpoint on the API — not a shorter interval, which just multiplies requests to chase a
delay it can never close."_ This document is that fix.

The server side is `backend/src/messaging/` — one controller, one service, three tables.
The client side is `frontend/lib/api/conversations.ts`, which already derives the caller
from the bearer token rather than accepting an id.

---

## 2. Transport

**Socket.IO** — `@nestjs/websockets` + `@nestjs/platform-socket.io` on the backend,
`socket.io-client` on the frontend. Nest has first-class gateway support, so it slots into
the existing module/DI structure rather than sitting beside it.

Two alternatives considered and rejected:

- **Raw `ws`.** Mobile connections drop constantly — backgrounding, cell↔wifi handoff,
  captive portals. Socket.IO ships reconnection-with-backoff, heartbeats and acks; with
  `ws` all of that is hand-written and subtly wrong the first few times.
- **SSE.** One-directional and needs no new protocol, which is genuinely attractive. But
  React Native's `fetch` has no `EventSource`, so it needs `react-native-sse` anyway — a
  dependency either way, for strictly less capability.

### The dependency manifest

**Decided 2026-09-22: recorded here, not installed.** Nothing is added to either
`package.json` until implementation actually starts — the root `CLAUDE.md` makes adding a
dependency a conversation, and this document is not that conversation. Writing the list down
means the decision at implementation time is "install these four," not "work out what we need."

| Package                          | Side       | Role                                     |
| -------------------------------- | ---------- | ---------------------------------------- |
| `@nestjs/websockets`             | `backend`  | gateway decorators, DI integration       |
| `@nestjs/platform-socket.io`     | `backend`  | the Socket.IO adapter Nest drives        |
| `socket.io`                      | `backend`  | peer dependency of the adapter           |
| `socket.io-client`               | `frontend` | the client                               |

Two notes for whoever installs them. The `@nestjs/*` pair must match the installed Nest major,
or the adapter fails at runtime rather than at `tsc`. And `socket.io-client` goes in
`frontend/`, which is a separate npm project — `cd frontend` first; there is no root
`package.json`.

No Redis client appears here on purpose: §4 ships `LISTEN`/`NOTIFY` first, and
`@socket.io/redis-adapter` arrives only if §13 decision 5 says so.

---

## 3. The socket is a delivery channel, not a write path

**Writes stay on REST.** `POST /conversations/:id/messages` is unchanged. The service
writes the row and publishes an event *in the same transaction* (§4 — "then publishes" would
be a dual write) that the gateway fans out. The socket carries
server→client events plus typing indicators, and nothing else.

This is the most important decision in the document.

The entire authorization boundary — `JwtAuthGuard`, DTO validation, `GlobalExceptionFilter`,
per-resource ownership scoping — is built around HTTP controllers, and **there is no RLS in
RDS**, so that boundary is the only thing between a caller and another user's data. Accepting
writes over a second protocol means reimplementing all of it inside a gateway, and any
divergence between the two implementations is a data breach rather than a bug. `AUTHORIZATION.md`
records seven holes found in the HTTP surface alone; a parallel write surface would be a second
place for the eighth to hide.

One write path, two read paths.

---

## 4. Infrastructure

| Concern               | What changes                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ALB**               | Express Mode's load balancer already speaks WebSocket (HTTP/1.1 `Upgrade`); no change. Its idle timeout is 60s and Socket.IO pings well inside that, so heartbeats must stay enabled.                                    |
| **Stickiness**        | Only needed if the HTTP long-polling fallback is allowed — the handshake must return to the same task. Forcing `transports: ['websocket']` removes the requirement.                                                      |
| **Fan-out**           | The real problem. See below.                                                                                                                                                                                             |
| **Graceful shutdown** | Scale-in kills live connections. `infra/ecs/task-definition.json` already sets `stopTimeout: 30`; use it to close sockets with a reason code on `SIGTERM` so clients reconnect at once instead of waiting out a timeout. |
| **Capacity**          | The task is 0.25 vCPU / 0.5 GB. Concurrent connections will hit a memory ceiling long before CPU matters. Emit connection count as a custom metric and alarm on it.                                                      |

### Fan-out across tasks

Today the service runs a single Fargate task, so an in-process `Map<userId, Socket[]>` is
sufficient. The moment Express Mode autoscales to two, a message written on task A never
reaches a socket held by task B. Two options:

- **Postgres `LISTEN`/`NOTIFY`** — no new infrastructure, uses the RDS instance already
  being paid for. The 8000-byte payload cap means publishing `{conversation_id, seq}` and
  letting each task read the row, which is the right shape anyway.
- **ElastiCache (Redis/Valkey) + `@socket.io/redis-adapter`** — the conventional answer,
  roughly $12-15/mo on top of the current ~$38, and required once presence lands because
  presence wants TTL'd keys.

**Plan: `LISTEN`/`NOTIFY` first, behind a publisher interface narrow enough that the Redis
adapter is a swap rather than a rewrite.** Revisit when presence ships or when NOTIFY
fan-out becomes a measurable bottleneck.

#### Publish inside the transaction, not after it

"The service writes the row, then publishes an event" (section 3) is a dual write, and the two
halves fail independently. Commit succeeds, the process is killed by a scale-in before the
publish, and the message exists in the database with nobody ever told about it. The reverse is
worse: publish first, transaction rolls back, and every connected client is told about a
message that does not exist.

`NOTIFY` avoids both **only if it is issued inside the writing transaction**, because Postgres
queues notifications and delivers them at commit, discarding them on rollback. That makes
publish-on-commit atomic with the write for free — which is a real argument for `LISTEN`/`NOTIFY`
over Redis that the original draft did not make, and a constraint the Redis swap would have to
replace with an outbox.

So the publish goes in `sendMessage`'s existing transaction, alongside the counter allocation:

```ts
await tx.execute(sql`select pg_notify('messaging', ${JSON.stringify({ conversationId, seq })})`);
```

Payload stays `{conversation_id, seq}` — well inside the 8000-byte cap, and each task reads the
row itself, which is the right shape regardless.

#### `LISTEN` needs its own connection, outside the pool

`db.module.ts` builds a `pg.Pool` with `max: 10`, deliberately small because the real ceiling is
(tasks x max) against a db.t4g.micro's ~85 connections. A `LISTEN` has to hold one connection
open permanently: issue it through Drizzle on a pooled client and it will appear to work, then
silently stop receiving the moment that connection is returned to the pool. Nothing errors. The
symptom is "realtime works locally and not in staging."

Use a dedicated `pg.Client` for the listener, owned by the gateway module, with its own
reconnect loop — and on reconnect, treat it as a gap: notifications sent while the listener was
down are simply gone, so every socket it serves needs the section 7 replay. Budget it as an
eleventh connection per task, not a tenth.

There is no RDS Proxy or PgBouncer in `infra/`, which is load-bearing here: a transaction-mode
pooler breaks `LISTEN` outright. If one is ever introduced, this design moves to Redis that day.

#### A wedged listener can break message *sending*

This is the sharp edge of putting `pg_notify` inside the write transaction, and it has to be
mitigated whatever §13 decision 5 lands on.

Postgres holds pending notifications in a fixed-size cluster-wide async queue. A listener that
stops consuming — a task that is alive but wedged, a connection that is open but not reading —
does not merely fall behind: once the queue fills, **transactions that call `pg_notify` start
failing.** Because the publish now shares the send transaction, that is not degraded realtime,
it is `POST /conversations/:id/messages` returning 500 for every user on every task. One stuck
listener takes down messaging.

Redis does not have this failure mode — a dead subscriber loses messages and nothing else — so
this is a genuine cost on the `LISTEN`/`NOTIFY` side of the ledger, not just a footnote.

Two mitigations, both cheap:

- **Alarm on `pg_notification_queue_usage()`** well before it matters. It returns the fraction
  of the queue in use; anything sustained above ~25% means a listener is not draining.
- **Make the listener part of the task's health check.** A task whose listener connection is
  dead or not consuming should fail its ECS health check and be replaced, rather than sitting
  there wedged and filling the queue on everyone else's behalf.

Note which way that second one cuts: the failure is cluster-wide, so a single bad task degrades
every other task's ability to write. Replacing it quickly is the whole mitigation.

---

## 5. Schema

The three existing tables are the right shape. `backend/src/db/schema.ts:228` (`conversations`),
`:236` (`conversation_members`), `:256` (`messages`).

### `messages` — five new columns

| Column                   | Purpose                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seq bigint`             | Per-conversation, commit-ordered. Display order and pagination cursor. **The important one.** Not a `bigserial` — see below.                         |
| `updated_seq bigint`     | Bumped on insert, edit *and* delete. What reconnect replay keys off. Equal to `seq` until the row is first mutated.                                   |
| `edited_at timestamptz`  | Null = never edited. The client renders "Edited" from its presence.                                                                                   |
| `deleted_at timestamptz` | Tombstone for unsend.                                                                                                                                 |
| `client_id uuid`         | Client-generated idempotency key, `UNIQUE (conversation_id, client_id)`. Makes send idempotent under retry **only if the conflict is handled** — below. |

`created_at` stays, but nothing orders or paginates on it any more. It is display metadata.

#### Why `seq` is not a `bigserial`

A `bigserial` allocates at `nextval()` during INSERT and becomes visible at COMMIT, and those
are different moments. Two concurrent sends can commit out of order: a client observes seq
101, persists `last_seen_seq = 101`, and *then* 100 commits. Every future replay asks for
`seq > 101`, so 100 is never delivered — a permanently missing message, with no error raised
anywhere and nothing in a log to find it by.

The window is narrow in a 1:1 thread, but "both people hit send at once" is not exotic, and
the whole of section 7 rests on this cursor being trustworthy. Sequences are also
non-transactional, so a rolled-back insert burns a number permanently — meaning any
client-side "I am missing 100, wait for it" recovery would wait forever.

So the counter is allocated **inside the writing transaction, under a row lock on the
conversation**, which makes it gapless and in commit order by construction.

#### Why there are two counters

`seq` is assigned once and never moves. An edit or an unsend of an *older* message therefore
does not change any row's `seq`, so a replay of `seq > cursor` cannot see it. A client that
was offline when a message was un-sent has the row, never hears about the `deleted_at`, and
displays the un-sent message forever.

That is precisely the failure the tombstone exists to prevent — an insert-keyed replay defeats
the justification for soft delete. Hence `updated_seq`: **order on `seq`, reconcile on
`updated_seq`.**

### Allocating the counter

`conversations` gets `last_seq bigint not null default 0`. `sendMessage`
(`conversations.service.ts:242 (`sendMessage`)`) already opens a transaction and already updates the
`conversations` row to bump `updated_at`, so allocation replaces a write that is happening
anyway:

```ts
// first statement in the existing transaction
const [{ last_seq: seq }] = await tx.execute(sql`
  update conversations
     set last_seq = last_seq + 1, updated_at = now()
   where id = ${conversationId}
  returning last_seq
`);

await tx.insert(messages).values({ ...fields, seq, updatedSeq: seq, clientId });
```

Three things fall out of this:

- **No new contention.** Writes to one conversation already serialize on that row via the
  `updated_at` bump. This moves that write to the top of the transaction rather than adding one.
- **Take the conversation lock first, always.** Edits, deletes and sends all touch the same
  row; a consistent lock order is what keeps them from deadlocking against each other.
- **Edit and delete allocate too.** They bump `last_seq` the same way and write only
  `updated_seq`, leaving `seq` alone so display order never shifts under the reader.

### `client_id` has to be handled, not just constrained

A unique index makes a retry *fail*, not succeed. In this repo it fails as a **400**:
`common/exceptions/not-unique.ts` maps unique violations to
`NotUniqueException extends BadRequestException`. So the exact case the column exists for — a
flaky mobile connection retrying a send it could not confirm — would surface to the user as a
validation error on a message that was delivered perfectly.

Idempotency is service-layer work:

```ts
const [created] = await tx
  .insert(messages)
  .values({ ... })
  .onConflictDoNothing({ target: [messages.conversationId, messages.clientId] })
  .returning({ ... });

// empty return means this client_id already landed: re-select and reply with the original row
```

The retry must get back the *same* row, including the same `seq`, and the endpoint must not
publish a second `message.created`. Validate `client_id` as a UUID in the DTO; it is
client-supplied and scoped per conversation, so the blast radius of a bad one is the sender's
own thread.

### `content` is `NOT NULL` today

`schema.ts:265` declares `content: text('content').notNull()`. Unsend as described — null out
`content` and `media_url` — cannot be written without dropping that constraint first. It is one
line in the migration, and it is the kind of thing that is discovered at 2am rather than in
review, so it is written down here.

Keep the tombstone semantics: keep the row, null the content, set `deleted_at`. A hard `DELETE`
leaves an offline client with no row to reconcile against.

**Edit overwrites** `content` and sets `edited_at`. No `message_edits` history table unless an
edit-history UI is actually wanted.

#### Unsending an image has to delete the object too

Messaging already supports image attachments, and this is where the tombstone design leaks.
Nulling `media_url` removes the *pointer*. The file itself stays in the `conversations` bucket,
and `frontend/lib/api/storage.ts:17` is explicit that **both buckets remain world-readable by
URL**. So an un-sent photo is still sitting at a public URL that the recipient's device has
already resolved and very likely cached.

That makes "unsend destroys the content" (§13 decision 2) false for exactly the message type
where it matters most. Unsend is not complete until the object is removed:

1. null `content` and `media_url`, set `deleted_at` — the transaction as designed;
2. delete the object from the `conversations` bucket, **after** the transaction commits.

Ordering matters and so does the failure mode. Delete the object first and a rollback leaves a
row pointing at nothing. Delete after commit and a crash in between leaves an orphaned object
with no row pointing at it — which is the safe direction, but it does mean the deletion needs to
be retryable rather than fire-and-forget. A sweeper over bucket objects with no referencing row
is the honest cleanup, and it wants the retention policy (§10 open question 3) to exist first.

None of this makes the already-cached copy on the recipient's phone go away. Nothing can. The
promise unsend can actually keep is "no longer retrievable," not "unseen."

### `conversation_members` — read receipts

`last_read_at` already exists. Replace it with `last_read_seq bigint`: comparing sequences is
exact where comparing timestamps inherits every tie-and-skew problem `seq` was added to solve.
Add `last_delivered_seq bigint` for the delivered-vs-read distinction.

**Deliberately not adding a `message_reads` table.** Per-message receipts cost
O(messages x members) rows and only buy "seen by 3 of 5" in group chats. This product is 1:1
coach↔athlete; one watermark per member is exactly sufficient. Revisit if group conversations
ship — see Open questions.

### What the migration touches

The watermark is not just a column. **Four** sites read the timestamps this replaces:

| Site                                                         | Today                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `backend/src/messaging/service/conversations.service.ts:194` | unread count, `m.created_at > coalesce(last_read_at, 'epoch'::timestamptz)`  |
| `backend/src/messaging/service/conversations.service.ts:217` | pagination cursor, `messages.created_at < before` — `listMessages(…, before)` |
| `backend/src/messaging/service/conversations.service.ts:279` | `POST /conversations/:id/read` sets `lastReadAt: new Date()`                 |
| `frontend/types/conversation.ts:19`                          | `last_read_at: string \| null` on `UserConversation`                          |

The `:161` cursor is the one the original draft missed, and it is the same bug in a second
place: two messages at the same microsecond mean a page boundary that either repeats a message
or skips one. It moves to `seq < before`.

That unread-count subquery is the argument for `seq` in miniature — it compares a message's
`created_at` against a watermark timestamp, so two messages written in the same microsecond, or
a row inserted by a task whose clock has drifted, land on the wrong side of the boundary. The
service comment above that query already flags the boundary as easy to get wrong. Switching both
sides to `seq` makes the comparison exact instead of approximately right.

#### Backfill

Adding the columns is not the migration; populating them is. In order, in one transaction:

```sql
-- 1. seq / updated_seq, ordered by the best proxy available for history
with ordered as (
  select id, row_number() over (
           partition by conversation_id order by created_at, id
         ) as n
    from messages
)
update messages m
   set seq = o.n, updated_seq = o.n
  from ordered o
 where o.id = m.id;

-- 2. the per-conversation high-water mark the allocator reads
update conversations c
   set last_seq = coalesce((select max(seq) from messages where conversation_id = c.id), 0);

-- 3. the read watermark, derived from the timestamp it replaces
update conversation_members cm
   set last_read_seq = coalesce((
         select max(m.seq) from messages m
          where m.conversation_id = cm.conversation_id
            and m.created_at <= cm.last_read_at), 0)
 where cm.last_read_at is not null;
```

Then `set not null` on `seq`, `updated_seq` and `last_seq`. `client_id` stays nullable —
Postgres permits many NULLs under a unique index, so historical rows need no treatment.

#### Indexes

| Index                                           | Why                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `(conversation_id, seq)`                        | thread reads and pagination, replacing the `created_at` composite |
| `(conversation_id, updated_seq)`                | the reconnect replay query, which the above cannot serve          |
| `(conversation_id, client_id)` unique           | idempotency                                                       |

`messages_conversation_id_created_at_idx` can be dropped once nothing sorts on `created_at`,
but drop it in a *later* migration than the one that stops using it — not the same one — so a
rollback does not land on an unindexed thread read.

#### Installed builds

`frontend/types/conversation.ts:19` is a **mobile app**, and it cannot be force-upgraded. An
API that stops returning `last_read_at` breaks every build already on a phone. The API serves
both for a deprecation window, deriving the timestamp from the watermark
(`select created_at from messages where seq = last_read_seq`), and drops it only once
telemetry says the old builds are gone.

Section 6 versions the socket envelope for exactly this reason. The REST surface deserves the
same courtesy, and the original draft did not give it any.

## 6. Event model

A versioned envelope, so the shape can change without breaking installed builds:

```
{ v: 1, type, conversation_id, seq, payload, server_ts }
```

Types: `message.created`, `message.edited`, `message.deleted`, `receipt.updated`,
`typing.started`, `typing.stopped`, `auth.expired`.

`auth.expired` is server→client and carries no payload beyond the envelope — it exists so a
client can tell "your token died, go get another" apart from "the network blipped." The one
client→server event in the whole design is `auth.refresh`, which is optional; see section 7.

Rooms: a socket joins `conversation:<id>` **after a membership check**, plus `user:<id>` for
inbox-level events (a new conversation, badge counts). The membership check follows the same
rule as the HTTP surface — prefer 404 over 403, because a 403 confirms the id names something
real and with enumerable ids that leaks who is talking to whom.

### The `user:<id>` room, specified

The draft named this room in a clause — "inbox-level events (a new conversation, badge
counts)" — and left it at that. It carries two things, and they behave differently:

- **`conversation.created`** — the caller has been added to a new conversation. The payload does
  not need to be a full inbox row: §8 already says invalidating the inbox list is the one place a
  refetch is cheap and correctness beats chattiness. Emit the id and let the list refetch.
- **Unread badges need no event at all.** This is a property the §5 counter buys and the draft
  did not notice: the client already knows `last_read_seq` for each conversation, and every
  `message.created` carries `seq`. The badge is `seq - last_read_seq`, computed locally, with no
  round trip and no separate `badge.updated` event to keep consistent. The server never has to
  tell a client something it can derive.

`receipt.updated` is the exception that needs both rooms: it goes to `conversation:<id>` so an
open thread can move the "Read" marker, and to the *other* member's `user:<id>` so their inbox
count settles even with the thread closed.

Joining `user:<id>` needs no membership check, because the id comes from the verified token and
never from the client — the same rule as everywhere else in this codebase. Do not accept a user
id in the join payload; that is the socket-shaped version of the `coach_id`-from-the-body bug the
root `CLAUDE.md` calls out.

### Typing indicators are the one client→server surface

Section 3's "one write path" has exactly one asterisk, and it is typing. That makes typing the
only place a client can push into the gateway, so it carries the rules the REST surface gets
from its guards and pipes:

- **A `typing.started` is a lease, not a state.** Expire it server-side after ~5s unless
  renewed. A client that crashes, backgrounds, or loses signal mid-compose never sends
  `typing.stopped`, and without a TTL the other party sees "typing…" forever. This is the most
  common way a chat feature looks broken.
- **Never echo to the sender.** Broadcast to the room minus the originating socket.
- **Rate limit it.** Keystroke-driven events are trivially spammable; one `typing.started` per
  socket per second is generous.
- **Never persist it.** Typing state lives in memory and dies with the connection.

---

## 7. The two hard parts

### Auth over a long-lived connection

Supabase JWTs expire (~1 hour by default) and a socket can outlive its token. **A socket
that authenticates once and then runs indefinitely is a live vulnerability**, and it is the
failure mode this design is most likely to ship by accident, because nothing about it is
visible in testing — every test session is shorter than an hour.

On the HTTP surface the problem does not exist. `JwtAuthGuard` re-verifies on *every* request
and rejects an elapsed `exp` with no clock-skew allowance
(`backend/src/common/validation/guards/auth-guard.ts:205`, which also treats a missing or
non-numeric `exp` as invalid rather than as "never expires"). Expiry is enforced continuously
because there is no session state — each request stands alone. The socket is what introduces
the gap, and with no RLS in RDS, the room membership check at join time would otherwise be the
only authorization that ever ran for that connection's entire life.

### The mechanism: `exp` is a disconnect timer

The handshake already produces verified claims. Read `exp` off them and schedule the socket's
own death:

```ts
// gateway handleConnection
const claims = this.jwtVerifier.verify(token); // the same path the guard uses
socket.data.userId = claims.sub;

const msUntilExpiry = claims.exp * 1000 - Date.now() - graceMs();
socket.data.expiryTimer = setTimeout(() => {
  socket.emit('auth.expired', { v: 1 });
  socket.disconnect(true);
}, Math.max(msUntilExpiry, 0));
```

The client treats `auth.expired` — and a disconnect carrying that reason — as: refresh through
`supabase.auth.getSession()` (the Supabase JS client auto-refreshes), set `socket.auth` to the
new token, reconnect.

**This is the baseline rather than the fallback because the reconnect path is already
mandatory.** Gap reconciliation, below, requires the client to persist
`last_seen_updated_seq` and replay on every reconnect; an expiry reconnect is just another
reconnect. The security
property comes free off machinery this design already owes you, for one event type and one
timer.

Three details that decide whether it actually works:

- **Disconnect *before* `exp`, not at it.** A grace of ~30s gives the client a window to
  refresh and reconnect cleanly instead of racing its own handshake against a token that just
  died. The guard allows zero clock skew, so a socket cutting it fine fails its own reconnect.
- **Jitter the grace.** After a deploy every socket reconnects within seconds of the others,
  so an hour later they all expire within seconds of the others. A few minutes of random
  jitter spreads the herd.
- **The reason code is load-bearing.** Socket.IO's default reconnect retries with whatever
  `auth` payload it already holds. A client that cannot tell expiry from a network blip
  reconnect-loops against a dead token and fails every handshake.

### Re-auth in place is an optimization on top, not an alternative

If the hourly reconnect proves visibly disruptive, add `auth.refresh`: the client pushes a
fresh token before expiry, the server re-verifies it through the same path and resets the
timer, and nothing disconnects.

The timer stays as the backstop regardless. A client can fail to refresh — offline, suspended,
crashed — and a deadline conditional on the client behaving is the original vulnerability with
extra steps. Re-auth shortens the interruption; it does not replace the deadline.

### Extract the verifier before either

`verifyLocally` is a private method on `JwtAuthGuard` today, so a gateway cannot call it and
whoever builds this will write a second verification. That is exactly the divergence section 3
spends its argument avoiding, in a nastier form: two copies of JWT verification drift silently
rather than failing loudly.

Pull it into an injectable `JwtVerifier` under `backend/src/common/`, have the guard delegate
to it, and give the gateway the same provider. `auth-guard.spec.ts` already pins the interesting
cases — `alg: none`, signature mismatch, absent `exp`, a required `aud`, and the opt-in `iss`
check behind `SUPABASE_JWT_ISSUER` — and those tests follow the logic into its new home, so the
gateway inherits the hardening instead of re-earning it.

The guard is **actively being hardened** (the `aud` claim became mandatory and the `iss` check
was added after this design was first drafted). That is the argument for extraction stated
twice: a second copy of this logic in a gateway would not merely risk drifting, it would already
be behind.

### What the timer does not fix

It bounds exposure to one token lifetime. It does nothing about revocation mid-session: sign
out on another device, or sever a coach relationship, and that socket keeps receiving events
until the token would have expired anyway.

That is no worse than the HTTP surface, where an issued bearer token also works until `exp`
because the guard consults no revocation list — but a socket holds the stale grant open
against a *live* event stream rather than requiring the caller to keep asking. Real revocation
means consulting shared state, and the fan-out design already provides the hook: the same
`LISTEN`/`NOTIFY` channel can carry "disconnect user X." Recorded in Open questions rather
than built.

### Gap reconciliation

Pub/sub alone is lossy: anything published while a client was disconnected is simply gone.

So the client persists **`last_seen_updated_seq`** per conversation and sends it on every
reconnect; the server replays every row with a higher `updated_seq`. The cursor is the change
counter, not the insert counter — replaying `seq > cursor` would return new messages while
silently losing every edit and unsend that happened to older ones, which is the §5 argument for
two counters.

Delivery becomes at-least-once, and the client dedupes on `message.id` — and on `client_id` for
its own optimistic sends.

**Replay is a read path and needs its own authorization.** It is tempting to treat the room
join as having settled it, but the replay query runs against `messages` directly, and there is
no RLS in RDS — so it re-asserts membership itself, the same as `assertMember` does on every
HTTP read (`conversations.service.ts:69 (`assertMember`)`). Two rules:

- **Re-check membership per replay**, not once per connection. A connection outlives the
  membership that authorized it (see §13.4).
- **Floor the cursor at the member's join point.** `greatest(cursor, seq_at_join)` — otherwise a
  client that sends `last_seen_updated_seq = 0` is handed the conversation's entire history,
  including everything written before they were a member. Harmless in a 1:1 thread that only
  ever had two members; a breach the day group conversations ship, which is exactly the kind of
  thing that gets built on top of an assumption nobody wrote down.

This is the difference between adding WebSockets and building a messaging system.

---

## 8. Frontend

- **`polling.ts` is not deleted.** It becomes the fallback when the socket cannot connect.
  Graceful degradation, and it is already written and working.

- **Polling and the socket are mutually exclusive, not layered.** Running both is not
  belt-and-braces, it is a race: a poll response already in flight when a socket patch lands can
  be *older* than the patch and will clobber it — resurrecting a deleted message, or dropping an
  edit, with no error. Drive `refetchInterval` off socket state (TanStack accepts a function) so
  a connected socket means `false`, and treat the socket as authoritative while it is up.

- Socket events patch the TanStack Query cache with `setQueryData`. **Not
  `invalidateQueries`** — that triggers a refetch, which is polling again with extra steps.
  Invalidate only the inbox list, where a refetch is cheap and correctness matters more than
  chattiness.

- **Patch by `seq`, never append.** At-least-once delivery plus reconnect replay means events
  arrive out of order and more than once as a matter of course. Insert at the position `seq`
  dictates and drop anything already present, keyed on `message.id`.

- **The server echo arrives twice.** Once as the HTTP response to `POST /messages`, once as
  `message.created` over the socket, in either order. Both paths must resolve to the same row:
  dedupe on `message.id` first, and use `client_id` only to match *your own* optimistic row.
  Reconciling on `client_id` alone duplicates every message you send.

- **Do not clobber a local image URI with a remote one.** `ChatBubble.tsx:31` already branches
  on whether `media_url` is a local device URI (`file…`/`content…`) or a storage path. An
  optimistic image row holds the local URI; the server echo holds the storage path. Replacing the
  row wholesale on reconcile makes a photo the user is looking at blank out and re-download over
  the network. Merge the echo's ids and `seq` onto the optimistic row and keep the local URI
  until the remote one is warm.

- **Replace the `isOptimistic` heuristic.** `ChatBubble.tsx:44` currently detects an unconfirmed
  row with `message.id.length < 30`. Once `client_id` exists, that guess has a real answer —
  "optimistic" means "no server id yet," and the length check should go rather than sit alongside
  a correct mechanism doing the same job differently.

- **Media upload is not covered by send idempotency.** The upload to the `conversations` bucket
  happens *before* the POST (`storage.ts:104 (`uploadImageMessage`)`), so a retried send with the same `client_id`
  correctly returns the original row but may already have uploaded a second copy of the image.
  Upload once, keep the returned path on the optimistic row, and reuse it across retries.

- **Render tombstones, do not remove rows.** A `message.deleted` that splices the row out of the
  list makes the thread jump under the reader's thumb. Keep the row, render "Message deleted."

- An `AppState` listener to reconnect and sync on foreground; React Native suspends sockets
  in the background. **Order matters on wake:** refresh the Supabase session *first* (after a
  night backgrounded the token is dead), then connect, then replay from `last_seen_updated_seq`.
  Connecting first just burns a failed handshake.

- **Bound the replay.** A client offline for a week asks for everything since; `listMessages`
  caps at 100 for good reason. Page the replay, and past some threshold fall back to "reload the
  thread" rather than streaming thousands of rows into the cache.

---

## 9. Explicitly out of scope

YAGNI list, recorded so it does not get rebuilt by accident:

- Presence / "online now" — wants Redis TTLs, and nothing in the product asks for it.
- Per-message read receipts — see section 5.
- Message reactions, threading, replies.
- Edit history UI.
- Push notifications for messages. Related, genuinely valuable, and a separate design.

  **But be clear about what that leaves.** React Native suspends sockets in the background, so a
  message that arrives while the app is not open produces nothing — no banner, no badge, no
  sound. That is true of polling today as well, so this is not a regression. It does mean
  "realtime messaging" only means realtime *while the app is open*, and the feature will read as
  half-built to anyone who expects otherwise. Worth setting that expectation before someone
  ships this and is surprised by the first bug report.

---

## 10. Open questions

1. ~~**When does `LISTEN`/`NOTIFY` stop being enough?**~~ Answered — §13 decision 5. The
   trigger is deliberately qualitative, and the reasoning for preferring that to a threshold is
   recorded there.
2. **Group conversations.** The schema (`conversation_members` as a join table) already
   permits them; the read-receipt watermark decision assumes they do not exist. If they land,
   section 5 is the part that changes.
3. **Retention.** Nothing currently deletes messages, and tombstones only add rows. Worth a
   policy before the table is large enough that adding one is a migration.
4. ~~**Does the ALB idle timeout need raising?**~~ Answered — no. §12 pins
   `pingInterval: 25000` / `pingTimeout: 20000` against the ALB's 60s idle and states the
   invariant (`pingInterval < idle timeout`) so the next person to touch either value knows
   what they are holding.
---

## 11. How this gets tested

Nothing in this design is verifiable by reading it, and two of its failure modes — expiry at
the one-hour mark, and a lost message under concurrent commit — are invisible in ordinary
manual testing. Worse, **the suite where socket tests naturally belong is the one that silently
does not run.** `backend-e2e` skips its remaining steps with a workflow warning when the
Supabase secrets are absent or the project is paused, so a green check is not evidence. See the
CI section of the root `CLAUDE.md`.

So the rule for this feature: **anything load-bearing gets a unit test, not an e2e test.**

| What                    | Test                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expiry disconnect       | Inject the clock and the grace into the gateway; sign a short-TTL HS256 token with a test secret and assert `auth.expired` then disconnect. Never `sleep`. The `JwtVerifier` extraction (§7) is what makes this reachable without Supabase. |
| Verifier parity         | The guard and the gateway must resolve the same token identically. One shared spec over `JwtVerifier` — `auth-guard.spec.ts` already pins `alg: none`, signature mismatch, absent `exp`, required `aud`, and the opt-in `iss` check. |
| Counter ordering        | Two concurrent transactions against the real local Postgres (`npm run db:up`, port 55440); assert the second blocks, and that the two messages' `seq` matches their commit order.                          |
| Replay completeness     | Mutate while "disconnected" — one insert, one edit, one delete — then replay from the pre-gap cursor and assert all three arrive. This is the test that would have caught the insert-cursor bug.           |
| Send idempotency        | Same `client_id` twice: one row, same `seq` returned both times, exactly one `message.created` published.                                                                                                 |
| Room authorization      | A non-member joining `conversation:<id>` gets the 404-shaped refusal, not a 403. Pin it the way `docs/AUTHORIZATION.md` pins the HTTP rules.                                                              |
| Backfill                | Run the §5 migration against a seeded database and assert `last_read_seq` reproduces the unread counts the timestamps produced.                                                                            |

The migration deserves its own rehearsal against a copy of production data before it runs
anywhere real. It rewrites every row in `messages`.

---

## 12. Limits, and what happens at them

The task is 0.25 vCPU / 0.5 GB. Every number here exists because the alternative is discovering
it during an outage.

- **Cap connections per user.** Nothing in the design stops one client reconnect-looping into
  fifty sockets. A cap of 3–5 per user id, rejecting the oldest, bounds a buggy build to an
  annoyance rather than a self-inflicted outage.
- **Jitter the reconnect, twice over.** §4's `SIGTERM` handling deliberately makes every client
  reconnect at once, and §7's expiry timer fires on a cohort that all authenticated at the same
  moment after a deploy. Each reconnect costs a handshake *and* a replay query. Both paths need
  randomised spread; they compound otherwise, and they compound onto a quarter of a vCPU.
- **Pin the heartbeat against the ALB.** `pingInterval: 25000`, `pingTimeout: 20000`, ALB idle
  60s. The invariant is `pingInterval < ALB idle timeout`; the defaults satisfy it, which is
  exactly why nobody notices when someone changes one of them. Assert it in config, not in prose.
- **Emit and alarm on:** connection count per task (memory is the ceiling, not CPU), reconnect
  rate, rows served per replay, `NOTIFY`→emit lag, and auth-expiry disconnects. The last one is
  the canary for the §7 timer silently not firing — if it drops to zero, the vulnerability is back.

---

## 13. Decisions

All five were open when this document was audited. All five were answered on
**2026-09-22** and are recorded here with their reasoning, because the reasoning is what a
future reader needs in order to know whether a decision is still valid — and every one of these
is scale-dependent, so each carries an explicit revisit trigger.

**A note on the premise decisions 2, 3 and 4 share.** All three lean on "this is a 1:1
coach↔athlete product." That is now enforced in code rather than assumed: `docs/AUDIT.md`
finding 1 caught that `createConversation` gated nothing — any signed-in user could search any
name and open a thread with them — and fixed it by requiring an active relationship in either
direction, plus coach-gating `searchAthletes`. The gate is on *creation* only, so any threads
predating it persist.

Still missing, and called out in that same finding: **there is no block and no report.** That is
the exact trigger written into decisions 2 and 4, so re-read both the day either ships.

**1. Adding the dependencies — recorded, not installed.** The manifest lives in §2. Nothing
touches `package.json` until implementation starts. *Revisit:* not a standing decision; it
expires the moment someone begins building this.

**2. Unsend destroys the content.** Nulling `content` and `media_url` is the design, as
written in §5 — no moderation copy, no retention window, no shadow table. "Unsend" means the
message is gone, and the product says that without an asterisk.

The cost is accepted knowingly: a harassment report filed after an unsend has nothing behind
it, on a product that plausibly has minors on it. This is a **pre-release solo project with no
moderation surface at all** — no reporting flow, no admin tooling, nobody to review evidence —
so retaining content would trade a clean user-facing promise for material no one can currently
act on. *Revisit when* a reporting flow is built, or before any launch that puts strangers
rather than a coach and their own athletes in a thread together. The revisit is a schema change
(retained copy) plus a policy, so it is not free — which is the argument for revisiting at the
right moment rather than deferring indefinitely.

*Implementation note added after the fact:* for images this decision is only honoured if the
unsend also deletes the object from the world-readable `conversations` bucket. Nulling the column
alone leaves the photo at a public URL. See §5.

**3. Read receipts are always on.** No per-user opt-out, and by extension no symmetry rule to
design around. The watermark in §5 is therefore unconditional, and `last_read_seq` can be
served to the other member without a visibility check.

This is the 1:1 coach↔athlete relationship doing the work: both parties have opted into a
coaching relationship, and "did my coach read this" is closer to a feature than a disclosure.
*Revisit when* group conversations ship or the social layer introduces messaging between users
who are not in a coaching relationship — at that point "always on" stops being defensible and
becomes a privacy default nobody chose. Note the retrofit cost: an opt-out changes what the API
may return, so it is an endpoint change, not a settings toggle.

**4. A one-token-lifetime revocation window is acceptable.** The §7 expiry timer bounds a stale
grant to ~1 hour and nothing closes it faster. Sign-out on another device, or a severed coach
relationship, can leave an open stream live for up to an hour.

Accepted because it is the same bound the HTTP surface already has — `JwtAuthGuard` consults no
revocation list, so an issued bearer token works until `exp` there too. Realtime does not make
this worse in kind, only in duration of a held-open stream. *Revisit when* there is a blocking
or safety feature, because "block this user" that takes an hour to bite is a broken promise in a
way that "signed out on my old phone" is not. The build is already scoped: `LISTEN`/`NOTIFY`
carrying "disconnect user X," reusing the §4 channel.

**5. The move to Redis has a qualitative trigger, not a threshold.** §4 ships fan-out on
Postgres `LISTEN`/`NOTIFY` behind a narrow publisher interface, and swaps to ElastiCache +
`@socket.io/redis-adapter` when **any one** of these happens:

- **Presence ships.** "Online now" wants keys that expire by themselves, which Postgres does not
  do — emulating it means a table and a sweeper, which is a polling loop, which is the thing this
  document exists to delete. This is the likeliest trigger by a wide margin.
- **A connection pooler is introduced.** RDS Proxy or PgBouncer in transaction mode breaks
  `LISTEN` outright (§4). Not a migration to plan, a migration to perform that day.
- **The `pg_notification_queue_usage()` alarm fires** (§4). Read this one carefully: it signals a
  wedged listener, which is a *bug*, not growth. Fix the listener first. It only argues for
  migrating if it keeps recurring, because the underlying hazard — a stuck listener failing every
  `pg_notify`, and therefore every send, cluster-wide — is a coupling Redis does not have.

**Explicitly not a throughput number.** The measurable triggers were drafted and rejected:
connections per task, `NOTIFY`→emit p99, task count. At this project's scale — pre-release, a
handful of coaches and their athletes, one Fargate task — none of them can fire. Writing them
down would produce a dashboard that looks like monitoring and never says anything, and a
threshold nobody can validate is worse than an honest qualitative trigger, because it invites
the next reader to trust it.

§12 still emits the telemetry. The difference is that it exists to explain an incident, not to
authorise a migration.

*Revisit when* any of the three triggers fires, or if the product's shape changes enough that
"a handful of coaches and their athletes" stops describing the load — the social layer landing
with messaging between strangers would qualify.
