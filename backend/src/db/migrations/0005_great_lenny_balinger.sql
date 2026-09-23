-- Existing duplicates have to be merged before the index can apply, and merging
-- here is not a delete: three rows called "Back Squat" may each be referenced by
-- workouts, templates and maxes. Deleting two of them would either violate the
-- foreign keys or orphan real training data.
--
-- So: pick a keeper per (created_by, lower(name)) -- the OLDEST, because it is
-- the one most likely to carry the longest history -- repoint every reference at
-- it, then delete the rest.
--
-- ⚠️ athlete_maxes is repointed LAST and with a conflict guard, because it is the
-- only one of the three with a uniqueness rule of its own: (athlete_id,
-- exercise_id). If an athlete somehow has a max against two duplicates, blindly
-- repointing the second would violate that index. The loser is dropped rather
-- than merged -- picking between two numbers for the same lift is a judgement
-- nobody asked this migration to make, and the kept one belongs to the exercise
-- that kept its history.
CREATE TEMP TABLE exercise_merge ON COMMIT DROP AS
SELECT
  e.id  AS duplicate_id,
  first_value(e.id) OVER (
    PARTITION BY e.created_by, lower(e.name)
    ORDER BY e.created_at ASC, e.id ASC
  ) AS keeper_id
FROM exercises e;

DELETE FROM exercise_merge WHERE duplicate_id = keeper_id;--> statement-breakpoint

UPDATE workout_exercises we
   SET exercise_id = m.keeper_id
  FROM exercise_merge m
 WHERE we.exercise_id = m.duplicate_id;--> statement-breakpoint

UPDATE exercise_templates et
   SET exercise_id = m.keeper_id
  FROM exercise_merge m
 WHERE et.exercise_id = m.duplicate_id;--> statement-breakpoint

-- Drop a max that would collide with one already held against the keeper.
DELETE FROM athlete_maxes am
 USING exercise_merge m
 WHERE am.exercise_id = m.duplicate_id
   AND EXISTS (
     SELECT 1 FROM athlete_maxes keep
      WHERE keep.athlete_id = am.athlete_id
        AND keep.exercise_id = m.keeper_id
   );--> statement-breakpoint

UPDATE athlete_maxes am
   SET exercise_id = m.keeper_id
  FROM exercise_merge m
 WHERE am.exercise_id = m.duplicate_id;--> statement-breakpoint

DELETE FROM exercises e
 USING exercise_merge m
 WHERE e.id = m.duplicate_id;--> statement-breakpoint

CREATE UNIQUE INDEX "exercises_created_by_lower_name_uniq" ON "exercises" USING btree ("created_by",lower("name"));