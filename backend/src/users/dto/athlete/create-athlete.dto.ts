import { ValueExists } from 'src/common/validation/decorators/validate-federation';
import { CreateUserDto } from '../create-user.dto';
import { IsOptional, IsString } from 'class-validator';

/** Data-transfer object designed for creating an athlete record in Supabase.
 * Contains all optional information that the user can choose to submit, with
 * appropriate validation decorators.
 *
 */
export class CreateAthleteDto extends CreateUserDto {
  @IsOptional()
  @IsString()
  @ValueExists('federations', 'code')
  federation?: string;

  @IsOptional()
  @IsString()
  @ValueExists('weight_classes', 'name')
  weight_class?: string;

  @IsOptional()
  @IsString()
  @ValueExists('divisions', 'name')
  division?: string;
}
