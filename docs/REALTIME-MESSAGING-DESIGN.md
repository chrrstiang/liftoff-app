# Real-time messaging — design

**Status: design only. None of this is built.** Drafted 2026-09-13. Messaging today is
HTTP polling (`frontend/lib/api/polling.ts`) and works; this describes what replacing it
would look like in production, plus read receipts and edit/unsend. Nothing here has been
implemented, no dependencies have been added, and no migration has been written.

For the flows this builds on see `ARCHITECTURE.md`. For who-may-reach-what see
`AUTHORIZATION.md` — the rules there are load-bearing for section 3.

---

## 1. Where messaging is now

Supabase Realtime was dropped when data moved to RDS, and two screens that depended on it
— the inbox and the open thread — were converted to polling:

| Constant | Value | Screen |
|---|---|---|
| `THREAD_POLL_MS` | 5s | open thread |
| `INBOX_POLL_MS` | 30s | conversation list |

`polling.ts` already names its own replacement: *"the honest fix is a websocket or SSE
endpoint on the API — not a shorter interval, which just multiplies requests to chase a
delay it can never close."* This document is that fix.

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

Per the root `CLAUDE.md`, adding any of these is a conversation to have before it happens,
not a side effect of this document.

---

## 3. The socket is a delivery channel, not a write path

**Writes stay on REST.** `POST /conversations/:id/messages` is unchanged. The service
writes the row, then publishes an event that the gateway fans out. The socket carries
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

| Concern | What changes |
|---|---|
| **ALB** | Express Mode's load balancer already speaks WebSocket (HTTP/1.1 `Upgrade`); no change. Its idle timeout is 60s and Socket.IO pings well inside that, so heartbeats must stay enabled. |
| **Stickiness** | Only needed if the HTTP long-polling fallback is allowed — the handshake must return to the same task. Forcing `transports: ['websocket']` removes the requirement. |
| **Fan-out** | The real problem. See below. |
| **Graceful shutdown** | Scale-in kills live connections. `infra/ecs/task-definition.json` already sets `stopTimeout: 30`; use it to close sockets with a reason code on `SIGTERM` so clients reconnect at once instead of waiting out a timeout. |
| **Capacity** | The task is 0.25 vCPU / 0.5 GB. Concurrent connections will hit a memory ceiling long before CPU matters. Emit connection count as a custom metric and alarm on it. |

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

---

## 5. Schema

The three existing tables are the right shape. `backend/src/db/schema.ts:179` (`conversations`),
`:187` (`conversation_members`), `:199` (`messages`).

### `messages` — four new columns

| Column | Purpose |
|---|---|
| `seq bigserial` | Monotonic ordering and cursor. **The important one.** `created_at` is unsafe for ordering and unsafe as a pagination cursor — clock skew, and ties at the same microsecond. Every "everything after X" query keys off `seq`. |
| `edited_at timestamptz` | Null = never edited. The client renders "Edited" from its presence. |
| `deleted_at timestamptz` | Tombstone for unsend. |
| `client_id uuid` | Client-generated idempotency key, `UNIQUE (conversation_id, client_id)`. Makes send idempotent under retry and lets the client match a server echo to its own optimistic row. |

### `conversation_members` — read receipts

`last_read_at` already exists. Replace it with `last_read_seq bigint`: comparing sequences
is exact where comparing timestamps inherits every tie-and-skew problem `seq` was added to
solve. Add `last_delivered_seq bigint` for the delivered-vs-read distinction.

**Deliberately not adding a `message_reads` table.** Per-message receipts cost
O(messages x members) rows and only buy "seen by 3 of 5" in group chats. This product is
1:1 coach↔athlete; one watermark per member is exactly sufficient. Revisit if group
conversations ship — see Open questions.

**What that migration touches.** The watermark is not just a column — three places read it:

| Site | Today |
|---|---|
| `backend/src/messaging/service/conversations.service.ts:138` | unread count, `m.created_at > coalesce(last_read_at, 'epoch'::timestamptz)` |
| `backend/src/messaging/service/conversations.service.ts:223` | `POST /conversations/:id/read` sets `lastReadAt: new Date()` |
| `frontend/types/conversation.ts:19` | `last_read_at: string | null` on `UserConversation` |

That unread-count subquery is the argument for `seq` in miniature: it compares a message's
`created_at` against a watermark timestamp, so two messages written in the same microsecond
— or a row inserted by a task whose clock has drifted — land on the wrong side of the
boundary. The service comment at line 108 already flags the boundary as easy to get wrong.
Switching both sides to `seq` makes the comparison exact instead of approximately right.

### Semantics worth fixing now

**Unsend is a soft delete**: keep the row, null out `content` and `media_url`, set
`deleted_at`. A hard `DELETE` is wrong — a client that was offline has no row to reconcile
against and will display the message forever. Nulling the content rather than retaining it
is what keeps "unsend" from being a lie at the database level.

**Edit overwrites** `content` and sets `edited_at`. No `message_edits` history table unless
an edit-history UI is actually wanted.

---

## 6. Event model

A versioned envelope, so the shape can change without breaking installed builds:

```
{ v: 1, type, conversation_id, seq, payload, server_ts }
```

Types: `message.created`, `message.edited`, `message.deleted`, `receipt.updated`,
`typing.started`, `typing.stopped`.

Rooms: a socket joins `conversation:<id>` **after a membership check**, plus `user:<id>` for
inbox-level events (a new conversation, badge counts). The membership check follows the same
rule as the HTTP surface — prefer 404 over 403, because a 403 confirms the id names something
real and with enumerable ids that leaks who is talking to whom.

---

## 7. The two hard parts

### Auth over a long-lived connection

Supabase JWTs expire (~1 hour by default) and a socket can outlive its token. The handshake
verifies the JWT using the same local verification path as `backend/src/common/validation/guards/auth-guard.ts`;
after that, either re-auth periodically over the socket or disconnect on expiry and let the
client reconnect with a fresh token.

**A socket that authenticates once and then runs indefinitely is a live vulnerability**, and
it is the failure mode this design is most likely to ship by accident, because nothing about
it is visible in testing — it only shows up an hour in.

### Gap reconciliation

Pub/sub alone is lossy: anything published while a client was disconnected is simply gone.

So the client persists `last_seen_seq` per conversation and sends it on every reconnect; the
server replays everything after it. Delivery becomes at-least-once, and the client dedupes on
`message.id` — and on `client_id` for its own optimistic sends.

This is the difference between adding WebSockets and building a messaging system.

---

## 8. Frontend

- **`polling.ts` is not deleted.** It becomes the fallback when the socket cannot connect.
  Graceful degradation, and it is already written and working.
- Socket events patch the TanStack Query cache with `setQueryData`. **Not
  `invalidateQueries`** — that triggers a refetch, which is polling again with extra steps.
  Invalidate only the inbox list, where a refetch is cheap and correctness matters more than
  chattiness.
- Optimistic send keyed on `client_id`, reconciled when the server echo arrives.
- An `AppState` listener to reconnect and sync on foreground; React Native suspends sockets
  in the background.

---

## 9. Explicitly out of scope

YAGNI list, recorded so it does not get rebuilt by accident:

- Presence / "online now" — wants Redis TTLs, and nothing in the product asks for it.
- Per-message read receipts — see section 5.
- Message reactions, threading, replies.
- Edit history UI.
- Push notifications for messages. Related, genuinely valuable, and a separate design.

---

## 10. Open questions

1. **When does `LISTEN`/`NOTIFY` stop being enough?** Needs a number — connections per task,
   or NOTIFY throughput — not a feeling. Until there is one, the trigger to move to Redis is
   "presence ships."
2. **Group conversations.** The schema (`conversation_members` as a join table) already
   permits them; the read-receipt watermark decision assumes they do not exist. If they land,
   section 5 is the part that changes.
3. **Retention.** Nothing currently deletes messages, and tombstones only add rows. Worth a
   policy before the table is large enough that adding one is a migration.
4. **Does the ALB idle timeout need raising?** Default 60s is fine against Socket.IO's
   default ping interval, but both values should be pinned explicitly rather than inherited.

---

## Appendix — describing this

For a résumé or a portfolio write-up, lead with the reconciliation and the boundary decision
rather than the technology:

> Designed a real-time messaging system for a React Native / NestJS app on ECS Fargate,
> replacing HTTP polling with Socket.IO while keeping all writes on the authenticated REST
> path to avoid duplicating the application's sole authorization boundary. Added read
> receipts and message edit/unsend via sequence-based watermarks and soft-delete tombstones,
> with idempotent sends and reconnect-time gap replay giving at-least-once delivery with
> client-side dedupe.

Shorter:

> Architected a WebSocket messaging layer (Socket.IO, NestJS, Postgres) replacing polling —
> sequence-based cursors for ordering and read receipts, tombstoned edit/unsend, and
> reconnect gap-replay for at-least-once delivery over unreliable mobile connections.

**"Designed" and "architected" are the accurate verbs while this document is the only
artifact.** They are defensible in an interview as long as the distinction is stated when
asked. Swap in "built" once it runs.
