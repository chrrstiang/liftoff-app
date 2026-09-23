-- Nothing has prevented two pending invitations for the same pair, so the index
-- below would fail to apply to any database that already holds a duplicate.
-- Collapse them first, keeping the OLDEST pending row per pair.
--
-- Oldest rather than newest, deliberately: the athlete has been looking at that
-- invitation, and its id is what their client holds. Keeping the newer row would
-- invalidate a notification they are about to tap.
--
-- Only `pending` rows are touched. Resolved history is left exactly as it is --
-- that is what the partial predicate exists to protect.
DELETE FROM "coach_requests"
WHERE "status" = 'pending'
  AND "id" IN (
    SELECT "id" FROM (
      SELECT
        "id",
        row_number() OVER (
          PARTITION BY "athlete_id", "coach_id"
          ORDER BY "created_at" ASC, "id" ASC
        ) AS rn
      FROM "coach_requests"
      WHERE "status" = 'pending'
    ) ranked
    WHERE rn > 1
  );--> statement-breakpoint
CREATE UNIQUE INDEX "coach_requests_one_pending_per_pair_uniq" ON "coach_requests" USING btree ("athlete_id","coach_id") WHERE "coach_requests"."status" = 'pending';