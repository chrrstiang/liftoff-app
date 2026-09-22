CREATE TABLE "athlete_maxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"override_value" double precision,
	"computed_value" double precision,
	"computed_at" timestamp with time zone,
	"computed_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "prescribed_percent" double precision;--> statement-breakpoint
ALTER TABLE "athlete_maxes" ADD CONSTRAINT "athlete_maxes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_maxes" ADD CONSTRAINT "athlete_maxes_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_maxes" ADD CONSTRAINT "athlete_maxes_computed_from_sets_id_fk" FOREIGN KEY ("computed_from") REFERENCES "public"."sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_maxes_athlete_id_idx" ON "athlete_maxes" USING btree ("athlete_id");--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_maxes_athlete_exercise_uniq" ON "athlete_maxes" USING btree ("athlete_id","exercise_id");