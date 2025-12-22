import { Request as ExpressRequest } from 'express';
import { User } from '@supabase/supabase-js';

export interface RequestWithUser extends ExpressRequest {
  user: User;
}
