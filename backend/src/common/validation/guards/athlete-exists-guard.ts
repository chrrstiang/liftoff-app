import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService } from 'src/supabase/supabase.service';

/** This guard ensures that an ID passed to a request as a parameter exists and corresponds with
 * an Athlete user. The ID is extracted from the params of the request, and used to query
 * the 'athletes' table, looking for a row with the given ID.
 *
 */
@Injectable()
export class AthleteExistsGuard implements CanActivate {
  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Typed params rather than an `as string` on the read: Express types
    // `params.id` as `string | string[]`, and the assertion form tripped
    // no-unnecessary-type-assertion under one @types/express resolution while
    // removing it tripped restrict-template-expressions at the throw below.
    // Declaring the shape satisfies both.
    const request = context.switchToHttp().getRequest<Request<{ id: string }>>();
    const athleteId = request.params.id;

    if (!athleteId) {
      throw new BadRequestException(`Must include ID of athlete requested.`);
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
    }

    return true;
  }
}
