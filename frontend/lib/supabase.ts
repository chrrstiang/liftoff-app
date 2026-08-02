import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

/**
 * Fail with something actionable. These used to carry non-null assertions, so a
 * missing variable surfaced as `supabaseUrl is required` thrown from inside
 * @supabase/supabase-js — which names neither the variable nor the file to
 * create. The backend does the same check for the same reason.
 */
if (!supabaseUrl || !supabaseKey) {
  const missing = [
    !supabaseUrl && "EXPO_PUBLIC_SUPABASE_URL",
    !supabaseKey && "EXPO_PUBLIC_SUPABASE_KEY",
  ]
    .filter(Boolean)
    .join(", ");

  throw new Error(
    `Missing ${missing}. Copy frontend/.env.example to frontend/.env and fill in ` +
      `your Supabase project values, then restart Metro with --clear ` +
      `(EXPO_PUBLIC_* values are inlined at bundle time, so a running server ` +
      `will not pick them up).`,
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});
