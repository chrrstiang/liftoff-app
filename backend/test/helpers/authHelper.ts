// test/helpers/auth.helper.ts
import { createClient } from '@supabase/supabase-js';

// good to get a new user for testing
export async function getTestUser(
  email: string,
  password: string,
): Promise<{ userId: string; accessToken: string }> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

  // Sign in as test user
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return { userId: data.session.user.id, accessToken: data.session.access_token };
}
