# Derived maxes and percentage prescription

**Status: the design for roadmap items 2 and 5, which are one feature.** Drafted 2026-09-22.
The backend lands first and ships endpoints nothing calls yet; the frontend follows.

Prior decisions this rests on are recorded in `ROADMAP.md` open questions 4, 5 and 6.

---

## 1. The problem

A coach programming in LiftOff types `suggested_load_min` / `suggested_load_max` as absolute
numbers, per set, per athlete. In Google Sheets they write `=0.75*$B$2` once and fill right.
For a percentage-based sport, **the tool is currently worse at its core task than the
spreadsheet it replaces**, and with ~17 athletes per coach that is the reason a migration
would fail.

Nothing in the schema holds a 1RM. `weight_classes.max_weight` is the upper bound of a weight
class, unrelated to strength. `prescribed_intensity` is free `text` holding either `"RPE 8"` or
`"75%"`, so nothing computes with it.

---

## 2. Decisions, and why

### 2.1 Maxes are per-exercise, not per-lift

**Rejected: one max per parent lift** (squat / bench / deadlift), with variations resolving
against it.

Each variation has its own difficulty and therefore its own max. A tempo squat at RPE 7 might
be 130kg where a comp squat at RPE 7 is 170kg. Prescribing tempo work as a percentage of a comp
squat max hands the athlete a number that is wrong by 40kg. A parent-lift model is not a
simplification of the domain, it is a misreading of it.

So a max keys to `exercise_id`. Every variation in a coach's library accumulates its own.

**The known cost, accepted deliberately:** `exercises.created_by` is `NOT NULL -> coaches.id`,
so libraries are per-coach. A coach change means the new coach's library rows have no history
and no derived maxes. That is survivable — it is rare, and an override can carry a number
across by hand — and the alternative is designing a canonical movement catalogue before anyone
knows which variations actually get programmed. Revisit when a coach actually leaves, or when
team leaderboards need lifts comparable across athletes. `ROADMAP.md` open question 4.

### 2.2 Maxes are derived from logged sets, with a coach override

**Rejected: the coach types every max.** Per-variation maxes mean roughly eight numbers per
athlete; seventeen athletes is ~136 numbers maintained by hand. That is the burden item 2 exists
to remove, reintroduced one layer down — and a stale max produces a silently wrong prescription.

Everything needed to derive them is already stored. Every logged set carries `actual_load`,
`prescribed_reps` and `actual_intensity` (RPE). Load x reps @ RPE is exactly the input to an
e1RM estimate, and because each variation's sets are logged separately, **each variation
maintains its own max for free**.

This is why items 2 and 5 are one feature rather than two. Shipping item 2 alone delivers the
maintenance burden without the thing that makes it bearable.

It also matches how coaching already works: prescribe RPE while there is no data, percentages
once there is. The bootstrap is not a problem to solve, it is a normal first block.

### 2.3 The load is computed on read; the max is the stable thing

**Rejected: snapshotting the resolved kg onto the set at write time.**

Freezing the kg turns a percentage back into a hand-typed number that merely remembers where it
came from. If an athlete's squat genuinely goes up, a peaking week prescribed at 92% *should*
get heavier — re-scaling is the entire point of programming in percentages.

But a max that recomputes on every logged set is not autoregulation, it is instability: a strong
Monday would move Wednesday's squats. So the stability lives in the **max**, not the load:

- `athlete_maxes.computed_value` is a stored number that only changes when something asks it to.
- Prescription resolves `prescribed_percent x effective max` when the workout is read.

**The trigger is the coach, for now.** A "refresh maxes" action. Least machinery, and it keeps a
human between a fluke RPE entry and everyone's programming. The derivation is written as a plain
function so a nightly job is a later wrapper rather than a rewrite.

⚠️ **Consequence worth knowing:** refreshing a max moves *every* future set prescribed as a
percentage of it, including weeks already written in a long block. That is intended.

---

## 3. Data model

```
athlete_maxes
  id              uuid pk
  athlete_id      uuid  NOT NULL -> athletes.id
  exercise_id     uuid  NOT NULL -> exercises.id
  override_value  double precision NULL   -- the coach's pinned number
  computed_value  double precision NULL   -- last derived e1RM
  computed_at     timestamptz      NULL   -- when derivation last ran
  computed_from   uuid             NULL -> sets.id
  created_at      timestamptz NOT NULL default now()
  UNIQUE (athlete_id, exercise_id)

sets
  + prescribed_percent  double precision NULL
```

**Effective max = `override_value ?? computed_value`.** An override is a pin, not a seed: it
wins until the coach clears it, so a coach who knows the athlete's comp squat is 180 is not
overruled by a cautious session.

`computed_from` is what makes a number reviewable. "180kg, from 170x2 @ RPE 8 on 12 Oct" can be
argued with; a bare 180 cannot.

A set has either a percentage or hand-typed loads, never both — `prescribed_percent` wins when
present, and the existing `suggested_load_*` columns are untouched.

---

## 4. The e1RM estimate

```
rtf   = prescribed_reps + (10 - actual_intensity)     RPE 8 on a triple = 5 reps to failure
e1RM  = actual_load * (1 + rtf / 30)                  Epley
```

Epley is weakest at high reps, and powerlifting work is mostly at or below eight, so it is fine
here. It is one pure function with no lookup table for anyone to maintain or get wrong.

**Sets with no logged RPE do not contribute.** `actual_intensity` is nullable and many sets will
not have it; treating those as taken to failure would inflate every max.

**Selection: the highest e1RM among sets logged in the last 28 days.** Not the most recent — a
max is a capability, and taking the latest would drop it after every deload.

---

## 5. Resolution

A set read back carries both `prescribed_percent` and the resolved load.

**A percentage with no max behind it resolves to a null load**, and the client renders
`75% — no max yet`. Not an error: prescribing percentages before there is data is the normal
first block, and it is fixed by an override or by the athlete logging one RPE set.

---

## 6. API

| Endpoint | Purpose |
|---|---|
| `GET /maxes?athlete_id=` | every max for an athlete, with source and provenance |
| `PATCH /maxes/:exerciseId` | set or clear an override (`athlete_id` in the body) |
| `POST /maxes/refresh` | recompute from logged sets |

The athlete is named in a query string or body rather than the path, matching
`GET /workouts/history?athlete_id=` — the most recent and most similar pattern in
the codebase. This is **not** the banned "actor id from the body": it names
*someone else*, and the service decides whether the caller may reach them.

Authorization reuses `programming-access.ts` rather than inventing rules:

- **Read** — `assertReadableAthlete`: the athlete themselves, or any active coach of them. This
  is deliberately the *wide* rule, matching the co-coach decision in `AUTHORIZATION.md`: a
  view-only head coach should see the numbers their athlete is being programmed against.
- **Write** — an active coach only. An athlete may not set their own max: it drives the
  prescription they are given, so writing it is programming.
- A caller with no claim gets **404, not 403**, per the rule throughout this codebase.

---

## 7. Out of scope, deliberately

- The canonical movement catalogue, and anything that survives a coach switch (2.1).
- Leaderboards and cross-athlete comparison.
- A nightly refresh job.
- Bulk assign — roadmap item 3, independent of this.
