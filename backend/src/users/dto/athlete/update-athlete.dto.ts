import { IsOptional, IsUUID } from 'class-validator';

/** The body of `PATCH /athlete/profile` — the three reference-data columns on the
 * caller's own `athletes` row.
 *
 * ⚠️ **This DTO used to be name-based** (`federation` / `weight_class` /
 * `division`, each behind `@ValueExists(table, name)`) and unused: it was written
 * as the design record for an endpoint nobody built, and `docs/ARCHITECTURE.md`
 * recorded that names "would need resolving and cross-validating against gender
 * and federation". Building the endpoint is what showed the resolving step cannot
 * be done at all:
 *
 *  - **A weight-class name is not unique.** `weight_classes` is keyed by
 *    (federation, gender, name), so "83" is two rows in one federation and more
 *    across federations. `@ValueExists('weight_classes', 'name')` proves *some*
 *    row has that name, which is not the same as knowing which one was meant.
 *  - **Division names collide the same way** — every federation has an "Open".
 *  - **The client already holds the ids.** The pickers on `create-profile.tsx`
 *    and `edit-profile.tsx` select whole reference rows, and `POST /users/profile`
 *    has always taken `federation_id` / `division_id` / `weight_class_id`. Names
 *    would mean the client throwing away an unambiguous id so the server could
 *    guess it back.
 *
 * So the field names here match `CreateUserDto`, the `athletes` columns, and the
 * `?data=` vocabulary of `GET /athlete/profile/:id`. The cross-validation the doc
 * asked for still happens — in `reference-validation.ts`, against the *merged*
 * row rather than the request, so a PATCH of one field is checked against the two
 * already stored.
 *
 * **`null` clears a column, `undefined` leaves it alone.** `@IsOptional()` skips
 * validation for both, and the service distinguishes them. Clearing matters
 * because changing gender invalidates a weight class: the client needs a way to
 * say "I no longer have one" rather than leaving a men's class on a women's
 * profile.
 *
 * This does **not** extend `PartialType(CreateUserDto)`, so there is no
 * inherited-optionality trap here — but note the one on `UpdateUserDto`, which
 * cost this codebase a working avatar upload. Every field below carries its own
 * explicit `@IsOptional()`.
 *
 * `@IsUUID()` rather than `CreateUserDto`'s `@IsString()`, which rejects a
 * malformed id here instead of letting it reach Postgres as a 22P02.
 * ⚠️ It is stricter than it looks — `@IsUUID()` checks the version and variant
 * nibbles, so `11111111-1111-1111-1111-111111111111` is **rejected** despite
 * matching the shape. Every id these columns can hold comes from
 * `gen_random_uuid()` or the seed file, and all 59 unique uuids in
 * `db/seed-reference-data.sql` were checked against this decorator and pass. Use
 * a real v4 uuid in any test that goes through validation.
 */
export class UpdateAthleteDto {
  @IsOptional()
  @IsUUID()
  federation_id?: string | null;

  @IsOptional()
  @IsUUID()
  division_id?: string | null;

  @IsOptional()
  @IsUUID()
  weight_class_id?: string | null;
}
