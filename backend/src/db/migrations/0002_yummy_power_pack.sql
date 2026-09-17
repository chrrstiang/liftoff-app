CREATE INDEX "coach_athlete_relationships_athlete_id_idx" ON "coach_athlete_relationships" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "coach_athlete_relationships_coach_id_idx" ON "coach_athlete_relationships" USING btree ("coach_id");--> statement-breakpoint
-- Nothing has ever prevented a duplicate (athlete_id, coach_id) pair, so the
-- unique index below would fail to apply against any database that already has
-- one. Collapse them first, keeping ONE row per pair.
--
-- The ORDER BY is the careful part: `(status = 'active') DESC` keeps a live
-- relationship in preference to a stale 'pending' duplicate. Ordering by
-- created_at alone could delete the active row and leave the pending one, which
-- would silently unlink a coach from an athlete who is actually training with
-- them. created_at then id breaks the remaining ties deterministically.
--
-- The enum is ('pending','active') -- there is no 'accepted'.
DELETE FROM "coach_athlete_relationships"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "athlete_id", "coach_id"
        ORDER BY ("status" = 'active') DESC, "created_at" ASC, "id" ASC
      ) AS rn
    FROM "coach_athlete_relationships"
  ) ranked
  WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "coach_athlete_relationships_athlete_coach_uniq" ON "coach_athlete_relationships" USING btree ("athlete_id","coach_id");--> statement-breakpoint
CREATE INDEX "coach_requests_athlete_id_idx" ON "coach_requests" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "coach_requests_coach_id_idx" ON "coach_requests" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_members_conversation_id_idx" ON "conversation_members" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "exercise_default_set_templates_exercise_template_id_idx" ON "exercise_default_set_templates" USING btree ("exercise_template_id");--> statement-breakpoint
CREATE INDEX "exercise_templates_created_by_idx" ON "exercise_templates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "exercise_templates_exercise_id_idx" ON "exercise_templates" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercises_created_by_idx" ON "exercises" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "sets_workout_exercise_id_set_number_idx" ON "sets" USING btree ("workout_exercise_id","set_number");--> statement-breakpoint
CREATE INDEX "workout_exercises_workout_id_order_idx" ON "workout_exercises" USING btree ("workout_id","order");--> statement-breakpoint
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workouts_athlete_id_date_idx" ON "workouts" USING btree ("athlete_id","date");--> statement-breakpoint
CREATE INDEX "workouts_coach_id_created_at_idx" ON "workouts" USING btree ("coach_id","created_at");