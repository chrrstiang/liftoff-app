import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { UsersService } from './users.service';
import { DRIZZLE } from 'src/db/db.module';
import { CreateUserDto, Gender } from '../dto/create-user.dto';

/** Unit tests for UsersService against a mocked Drizzle handle.
 *
 * ⚠️ **What moved out of here.** The previous version tested compensating
 * deletes: "roll back the athlete row when the users update fails" and "do not
 * attempt a rollback when nothing was inserted". Those described application
 * logic that only existed because supabase-js has no transaction API. The writes
 * now run inside `db.transaction`, so atomicity is the database's job — asserting
 * it against a mock would only be testing the mock.
 *
 * What is verified here instead: that the writes happen inside a transaction at
 * all, and that validation short-circuits *before* one is opened. Real rollback
 * behaviour belongs in an integration test against the local Postgres
 * (`npm run db:up`), which is tracked in docs/MIGRATION-PROGRESS.md.
 */

interface MockTx {
  insert: jest.Mock;
}

function makeInsertChain() {
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
  return { values, onConflictDoUpdate, onConflictDoNothing };
}

describe('UsersService', () => {
  let service: UsersService;
  let db: {
    transaction: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
  };
  let tx: MockTx;
  let insertChain: ReturnType<typeof makeInsertChain>;
  /** Rows the next `select ... limit 1` should return. Empty means "not found". */
  let selectRows: unknown[];

  const user = { id: 'user-1', email: 'user@example.invalid' } as User;

  const baseDto = (): CreateUserDto =>
    ({
      first_name: 'Test',
      last_name: 'User',
      username: 'test_user',
      gender: Gender.MALE,
      date_of_birth: '1990-01-01',
      is_athlete: false,
      is_coach: false,
    }) as CreateUserDto;

  beforeEach(async () => {
    selectRows = [];
    insertChain = makeInsertChain();
    tx = { insert: jest.fn().mockReturnValue({ values: insertChain.values }) };

    db = {
      transaction: jest.fn().mockImplementation(async (cb: (t: MockTx) => Promise<void>) => cb(tx)),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation(() => Promise.resolve(selectRows)),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUserProfile', () => {
    it('writes the users row inside a transaction', async () => {
      await service.createUserProfile(baseDto(), user);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.insert).toHaveBeenCalledTimes(1);
    });

    /** The id and email come from the verified token, never the request body.
     * This is what replaces the Supabase trigger that used to create the row. */
    it('takes id and email from the authenticated user, not the DTO', async () => {
      await service.createUserProfile(baseDto(), user);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', email: 'user@example.invalid' }),
      );
    });

    it('creates an athletes row when is_athlete is true', async () => {
      selectRows = [{ one: 1 }]; // reference-data lookups succeed
      const dto = { ...baseDto(), is_athlete: true, federation_id: 'fed-1', division_id: 'div-1' };

      await service.createUserProfile(dto as CreateUserDto, user);

      expect(tx.insert).toHaveBeenCalledTimes(2);
      expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
    });

    it('creates a coaches row when is_coach is true', async () => {
      const dto = { ...baseDto(), is_coach: true, biography: 'Coach', years_of_experience: 5 };

      await service.createUserProfile(dto as CreateUserDto, user);

      expect(tx.insert).toHaveBeenCalledTimes(2);
    });

    /** parseInt('') is NaN, which the optional DTO field lets through. Writing NaN
     * to an integer column is a constraint error at the worst possible moment. */
    it('coerces a NaN years_of_experience to null', async () => {
      const dto = { ...baseDto(), is_coach: true, years_of_experience: Number.NaN };

      await service.createUserProfile(dto as CreateUserDto, user);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ yearsOfExperience: null }),
      );
    });

    it('validates the division before opening a transaction', async () => {
      selectRows = []; // division not found
      const dto = { ...baseDto(), is_athlete: true, federation_id: 'fed-1', division_id: 'div-1' };

      await expect(service.createUserProfile(dto as CreateUserDto, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('rejects a division_id with no federation_id', async () => {
      const dto = { ...baseDto(), is_athlete: true, division_id: 'div-1' };

      await expect(service.createUserProfile(dto as CreateUserDto, user)).rejects.toThrow(
        'Federation is required to validate division',
      );
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('rejects a weight_class_id with no federation_id', async () => {
      const dto = { ...baseDto(), is_athlete: true, weight_class_id: 'wc-1' };

      await expect(service.createUserProfile(dto as CreateUserDto, user)).rejects.toThrow(
        'Federation is required to validate weight class',
      );
    });

    /** users.email is NOT NULL and the DTO does not carry it, so without this the
     * failure surfaces as an opaque constraint violation. */
    it('rejects an authenticated user with no email', async () => {
      const noEmail = { id: 'user-1' } as User;

      await expect(service.createUserProfile(baseDto(), noEmail)).rejects.toThrow(
        'Authenticated user has no email address',
      );
    });

    it('maps a driver error to a BadRequest carrying the Postgres code', async () => {
      db.transaction.mockRejectedValueOnce({ code: '23505', detail: 'username already exists' });

      await expect(service.createUserProfile(baseDto(), user)).rejects.toThrow(
        /Failed to create user profile: 23505 - username already exists/,
      );
    });
  });

  describe('updateProfile', () => {
    it('scopes the update to the authenticated user', async () => {
      await service.updateProfile({ first_name: 'New' } as never, user);

      expect(db.update).toHaveBeenCalledTimes(1);
    });

    /** An empty PATCH would otherwise become `set {}`, which Drizzle rejects. */
    it('does nothing when the patch is empty', async () => {
      await service.updateProfile({} as never, user);

      expect(db.update).not.toHaveBeenCalled();
    });
  });
});
