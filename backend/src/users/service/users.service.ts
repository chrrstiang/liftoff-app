import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { athletes, coaches, divisions, users, weightClasses } from 'src/db/schema';
import { UpdateUserDto } from '../dto/update-user.dto';
import { CreateUserDto, Gender } from '../dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Creates the caller's profile across `users`, and `athletes`/`coaches` as
   * their roles require.
   *
   * ⚠️ **This now INSERTS the users row rather than updating it.** On Supabase a
   * trigger on `auth.users` created `public.users` at signup and copied the email
   * across, so this method only ever had to fill in the rest. That trigger does
   * not exist in RDS — auth lives in a different database entirely and there is no
   * foreign key between them — so the API owns row creation. The id and email come
   * from the verified JWT, never from the request body.
   *
   * The whole thing runs in a **real transaction**. The previous version
   * hand-rolled compensating deletes because supabase-js has no transaction API;
   * that narrowed the window for a half-created profile but could not close it. A
   * failure anywhere now rolls back everything.
   */
  async createUserProfile(dto: CreateUserDto, user: User): Promise<void> {
    // Cross-field validation stays outside the transaction: these are reads, and
    // failing here should produce a clean 400 rather than an aborted transaction.
    if (dto.is_athlete) {
      if (dto.division_id) {
        await this.validateDivision(dto.division_id, dto.federation_id);
      }
      if (dto.weight_class_id) {
        await this.validateWeightClass(dto.weight_class_id, dto.federation_id, dto.gender);
      }
    }

    if (!user.email) {
      // users.email is NOT NULL and the DTO does not carry it, so a token without
      // one would fail at the constraint with a far less obvious message.
      throw new BadRequestException('Authenticated user has no email address');
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values({
            id: user.id,
            email: user.email!,
            firstName: dto.first_name,
            lastName: dto.last_name,
            username: dto.username,
            gender: dto.gender,
            dateOfBirth: dto.date_of_birth,
            isAthlete: dto.is_athlete,
            isCoach: dto.is_coach,
          })
          // Re-submitting completes the same profile rather than failing on the
          // primary key. Email is deliberately not updated here -- it is the
          // identity provider's, not the client's.
          .onConflictDoUpdate({
            target: users.id,
            set: {
              firstName: dto.first_name,
              lastName: dto.last_name,
              username: dto.username,
              gender: dto.gender,
              dateOfBirth: dto.date_of_birth,
              isAthlete: dto.is_athlete,
              isCoach: dto.is_coach,
            },
          });

        if (dto.is_coach) {
          await tx
            .insert(coaches)
            .values({
              id: user.id,
              biography: dto.biography,
              // parseInt('') is NaN, which the DTO allows through as optional.
              yearsOfExperience: Number.isFinite(dto.years_of_experience)
                ? dto.years_of_experience
                : null,
            })
            .onConflictDoNothing();
        }

        if (dto.is_athlete) {
          await tx
            .insert(athletes)
            .values({
              id: user.id,
              federationId: dto.federation_id ?? null,
              divisionId: dto.division_id ?? null,
              weightClassId: dto.weight_class_id ?? null,
            })
            .onConflictDoNothing();
        }
      });
    } catch (error) {
      throw UsersService.toHttpError(error, 'Failed to create user profile');
    }
  }

  /** Updates the caller's own users row. Scoped by id from the verified JWT —
   * with no RLS behind this, that scoping is the entire authorization. */
  async updateProfile(dto: UpdateUserDto, user: User): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (dto.first_name !== undefined) patch.firstName = dto.first_name;
    if (dto.last_name !== undefined) patch.lastName = dto.last_name;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.date_of_birth !== undefined) patch.dateOfBirth = dto.date_of_birth;
    if (dto.is_athlete !== undefined) patch.isAthlete = dto.is_athlete;
    if (dto.is_coach !== undefined) patch.isCoach = dto.is_coach;

    if (Object.keys(patch).length === 0) return;

    try {
      await this.db.update(users).set(patch).where(eq(users.id, user.id));
    } catch (error) {
      throw UsersService.toHttpError(error, 'Failed to update user profile');
    }
  }

  /** Turns a driver error into a 400 carrying the Postgres code.
   *
   * Replaces handleSupabaseError. Keeps the shape callers already expect —
   * `${message}: ${code} - ${detail}` — so the e2e assertions still hold. */
  private static toHttpError(error: unknown, message: string): BadRequestException {
    const pg = error as { code?: string; message?: string; detail?: string };
    const code = pg?.code ?? 'UNKNOWN';
    const detail = pg?.detail ?? pg?.message ?? String(error);
    console.error(error);
    return new BadRequestException(`${message}: ${code} - ${detail}`);
  }

  private async validateDivision(divisionId: string, federationId?: string): Promise<void> {
    if (!federationId) {
      throw new BadRequestException('Federation is required to validate division');
    }

    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(divisions)
      .where(and(eq(divisions.id, divisionId), eq(divisions.federationId, federationId)))
      .limit(1);

    if (rows.length === 0) throw new BadRequestException('Division not found');
  }

  private async validateWeightClass(
    weightClassId: string,
    federationId: string | undefined,
    gender: Gender,
  ): Promise<void> {
    if (!federationId) {
      throw new BadRequestException('Federation is required to validate weight class');
    }

    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(weightClasses)
      .where(
        and(
          eq(weightClasses.id, weightClassId),
          eq(weightClasses.federationId, federationId),
          eq(weightClasses.gender, gender),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw new BadRequestException('Weight class not found');
  }
}
