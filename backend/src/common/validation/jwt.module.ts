import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { JwtVerifier } from './jwt-verifier';

/** Token verification, available everywhere.
 *
 * ⚠️ **`@Global()` on purpose, following `DbModule`.** `JwtAuthGuard` is applied
 * per-route across four feature modules, and a module that forgets to import its
 * provider fails at **Nest bootstrap — not at `tsc`**. `npm run build` stays
 * green, and the e2e suite that would catch it is the one that silently skips
 * when Supabase secrets are absent. Making it global removes the failure mode
 * rather than documenting it.
 *
 * `SupabaseModule` is imported only for the remote fallback path, which is the
 * one `supabase.auth.getUser()` call left in the request lifecycle.
 */
@Global()
@Module({
  imports: [SupabaseModule],
  providers: [JwtVerifier],
  exports: [JwtVerifier],
})
export class JwtModule {}
