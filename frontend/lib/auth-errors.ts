/** Turning a Supabase auth failure into something an athlete can act on.
 *
 * Both auth screens used to show one generic "please check your credentials",
 * which is worst exactly where it matters: a returning user who forgot they had
 * an account was told their *password* was wrong and went off guessing
 * passwords instead of signing in. With no password reset, that is a permanent
 * lockout — see finding 6 in `docs/AUTHORIZATION.md`'s sibling `docs/AUDIT.md`.
 *
 * Supabase does distinguish these; the context was throwing the detail away.
 */

/** The failures the UI actually branches on. Anything else is `unknown` and
 * gets the caller's fallback — a wrong guess reads worse than a vague truth. */
export type AuthFailureCode =
  | "user_already_exists"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "weak_password"
  | "rate_limited"
  | "unknown";

/** Thrown by `AuthContext` for a failure Supabase reports as a *success*.
 *
 * Signing up with an address that already exists returns no error when email
 * confirmation is on — Supabase obfuscates it deliberately, so the only tell is
 * an empty `identities` array on the returned user. */
export class AuthFailure extends Error {
  constructor(
    readonly code: AuthFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthFailure";
  }
}

/** Reads Supabase's stable `error.code`, falling back to its message text.
 *
 * The message check is not redundant: `code` was added to supabase-js partway
 * through v2 and older self-hosted GoTrue versions still answer without it. */
export function authFailureCode(error: unknown): AuthFailureCode {
  if (error instanceof AuthFailure) return error.code;

  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  const message = error instanceof Error ? error.message : "";

  if (code === "user_already_exists" || /already registered/i.test(message)) {
    return "user_already_exists";
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "invalid_credentials";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "email_not_confirmed";
  }
  if (code === "weak_password" || /password should be/i.test(message)) {
    return "weak_password";
  }
  if (typeof code === "string" && code.includes("rate_limit")) return "rate_limited";
  if (/rate limit|too many requests/i.test(message)) return "rate_limited";

  return "unknown";
}

/** A sentence to put under the form. `fallback` covers `unknown`. */
export function describeAuthError(error: unknown, fallback: string): string {
  switch (authFailureCode(error)) {
    case "user_already_exists":
      return "An account already uses that email. Try signing in instead.";
    case "invalid_credentials":
      return "That email and password do not match an account.";
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the link we sent.";
    case "weak_password":
      return "That password is too weak. Use 8 or more characters.";
    case "rate_limited":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return fallback;
  }
}

export const MIN_PASSWORD_LENGTH = 8;

/** Client-side checks, so a typo costs a keystroke rather than a round trip.
 *
 * The email test is deliberately loose. Anything stricter rejects addresses
 * that are perfectly valid, and the only real test is whether mail arrives. */
export function validateCredentials(fields: {
  email: string;
  password: string;
  /** Omit on the login screen, which has no confirm field. */
  confirmPassword?: string;
}): { email?: string; password?: string; confirmPassword?: string } {
  const problems: { email?: string; password?: string; confirmPassword?: string } = {};

  if (!fields.email.trim()) {
    problems.email = "Enter your email.";
  } else if (!/^\S+@\S+\.\S+$/.test(fields.email.trim())) {
    problems.email = "That does not look like an email address.";
  }

  if (!fields.password) {
    problems.password = "Enter a password.";
  } else if (fields.confirmPassword !== undefined && fields.password.length < MIN_PASSWORD_LENGTH) {
    // Only enforced at signup. On login the stored password is whatever it is,
    // and refusing to submit a short one would lock out an early account.
    problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (fields.confirmPassword !== undefined && fields.password !== fields.confirmPassword) {
    problems.confirmPassword = "These do not match.";
  }

  return problems;
}
