import { Gender } from '../dto/create-user.dto';

export interface UserData {
  first_name: string;
  last_name: string;
  gender: Gender;
  username: string;
  date_of_birth: string;
  is_athlete: boolean;
  is_coach: boolean;
}
