import { Module } from '@nestjs/common';
import { AthleteController } from './controller/athlete/athlete.controller';
import { AthleteService } from './service/athlete/athlete.service';
import { SupabaseService } from 'src/supabase/supabase.service';
import { UsersService } from './service/users.service';
import { UserController } from './controller/users.controller';

/*
Module encapsulating logic and information regarding users. Athlete-specific reads
live in AthleteController; coaches have no controller of their own.

`CoachController` / `CoachService` used to be mounted here. They were unimplemented
Nest CLI scaffolding — every method returned a string literal — but they were
registered, so six routes were served with no `@UseGuards` at all, two of them
mutations. Nothing called them. Deleted rather than guarded: an unauthenticated
placeholder is a trap for whoever implements the service later. See
docs/AUTHORIZATION.md.
*/
@Module({
  controllers: [AthleteController, UserController],
  providers: [AthleteService, SupabaseService, UsersService],
})
export class UsersModule {}
