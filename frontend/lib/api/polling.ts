/** Polling intervals, in one place.
 *
 * Supabase realtime is gone: data lives in RDS behind the API, and there is no
 * subscription to hold. Two screens depended on it — the inbox and the open thread
 * — and both now poll.
 *
 * The two intervals differ by an order of magnitude because the cost of being
 * stale differs by an order of magnitude. A message arriving up to five seconds
 * late in a thread you are staring at is noticeable; the same delay on an inbox
 * badge is not, and polling the inbox at 5s would mean twelve requests a minute per
 * signed-in user for a number that rarely changes.
 *
 * These are a deliberate downgrade from realtime, not a permanent answer. If
 * messaging becomes central, the honest fix is a websocket or SSE endpoint on the
 * API — not a shorter interval, which just multiplies requests to chase a delay it
 * can never close.
 */

/** An open message thread. Short enough to feel live in conversation. */
export const THREAD_POLL_MS = 5_000;

/** The conversation list. Long enough not to be a background tax. */
export const INBOX_POLL_MS = 30_000;
