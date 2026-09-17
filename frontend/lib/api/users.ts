import { api } from "@/lib/api/client";
import type { ProfilePatch } from "@/types";

/** The caller's own `users` row.
 *
 * ⚠️ **No id argument, and there must never be one.** `PATCH /users/profile`
 * derives the row from the verified token, so a user can only ever update
 * themselves. `lib/api/storage.ts` records the same decision: `updateUserAvatar`
 * used to take a `userId` and write that row, which meant it could point any
 * user's avatar at any path.
 *
 * ⚠️ **Pass only the fields that changed.** See the comment on `ProfilePatch` —
 * the username uniqueness check matches the caller's own row, so a whole-form
 * PATCH is a 400.
 */
export async function updateUserProfile(patch: ProfilePatch): Promise<void> {
  await api.patch("/users/profile", patch);
}
