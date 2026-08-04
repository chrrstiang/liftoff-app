/** The HTTP client for the NestJS API.
 *
 * Everything that talks to the backend goes through here. Landing this before any
 * migration slice branches is deliberate: three slices written in parallel would
 * otherwise each invent their own client, and reconciling them afterwards is worse
 * than agreeing on one now.
 *
 * What it centralises:
 *  - base URL resolution, with a *named* failure when it is missing
 *  - the Authorization header, pulled from the current Supabase session
 *  - the API's single error envelope, so callers get real messages
 */

import { supabase } from "@/lib/supabase";

/** The API's error shape. Every non-2xx response from the backend has this body,
 * produced by GlobalExceptionFilter.
 *
 * `message` is an **array** for ValidationPipe failures and a **string** for
 * manually thrown exceptions. That distinction is why the filter reads
 * `exception.getResponse()` rather than `exception.message`, and callers should not
 * have to care — see ApiError.messages.
 */
interface ApiErrorEnvelope {
  statusCode: number;
  message: string | string[];
  timestamp: string;
  path: string;
  method: string;
}

/** Thrown for any non-2xx response.
 *
 * Carries every field of the envelope, because losing them is how the previous
 * inline fetch ended up showing "Failed to create profile" for a response that
 * actually listed exactly which fields were invalid.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  /** Always an array, however the server phrased it. One entry for a thrown
   * exception, one per field for a validation failure. */
  readonly messages: string[];
  readonly path?: string;
  readonly method?: string;

  constructor(statusCode: number, messages: string[], path?: string, method?: string) {
    super(messages.join("\n"));
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.messages = messages;
    this.path = path;
    this.method = method;
  }

  /** True for 400s carrying per-field validation messages, so a caller can decide
   * to render them against form fields rather than in an alert. */
  get isValidationError(): boolean {
    return this.statusCode === 400 && this.messages.length > 1;
  }
}

/** Raised when EXPO_PUBLIC_API_URL is not set.
 *
 * This exists because of a specific trap: `EXPO_PUBLIC_*` values are inlined at
 * bundle time, and a missing one becomes the literal string "undefined" in the URL.
 * React Native then reports "Network request failed", which reads as a connectivity
 * problem and sends you debugging the wrong thing entirely. Fail by name instead.
 */
export class ApiConfigError extends Error {
  constructor() {
    super(
      "EXPO_PUBLIC_API_URL is not set. Copy frontend/.env.example to frontend/.env " +
        "and restart Metro with --clear (a running server will not pick up the change). " +
        "On a physical device use your machine's LAN IP — localhost will not resolve.",
    );
    this.name = "ApiConfigError";
  }
}

function getBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) throw new ApiConfigError();
  return url.replace(/\/+$/, "");
}

/** Normalises whatever came back into a list of messages.
 *
 * Not every non-2xx body is the API's envelope: an ALB returns HTML for a 502, and
 * a dead container yields no body at all. Both used to surface as an unhelpful JSON
 * parse error, which matters more once this is behind a load balancer.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return new ApiError(response.status, [
      response.status >= 500
        ? `Server error (${response.status}). The API returned a non-JSON response — it may be starting up or unavailable.`
        : `Request failed (${response.status}).`,
    ]);
  }

  const envelope = body as Partial<ApiErrorEnvelope>;
  const raw = envelope?.message;

  const messages =
    Array.isArray(raw) ? raw
    : typeof raw === "string" ? [raw]
    : [`Request failed (${response.status}).`];

  return new ApiError(
    envelope?.statusCode ?? response.status,
    messages,
    envelope?.path,
    envelope?.method,
  );
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Overrides the token read from the current Supabase session. Handy when a
   * caller already has one in hand and wants to avoid the extra await. */
  accessToken?: string;
  /** Set false for endpoints that do not require auth (currently only /health). */
  authenticated?: boolean;
  signal?: AbortSignal;
}

/** Issues a request and returns the parsed body.
 *
 * Auth comes from the live Supabase session rather than a passed-in token, so
 * callers cannot accidentally send a stale one. Supabase refreshes access tokens in
 * the background, and `getSession()` returns the current pair.
 *
 * @throws ApiConfigError when EXPO_PUBLIC_API_URL is unset
 * @throws ApiError for any non-2xx response
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, accessToken, authenticated = true, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (authenticated) {
    let token = accessToken;

    if (!token) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    }

    if (!token) {
      // A 401 round trip would tell us the same thing, more slowly and less clearly.
      throw new ApiError(401, ["Not signed in."]);
    }

    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw await toApiError(response);

  // 204 and empty bodies are legitimate; don't make callers guard for it.
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "GET" }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "DELETE" }),
};

/** Turns any thrown value into something worth putting in an Alert.
 *
 * Callers mostly want one string, and `error.message` on a raw fetch failure is
 * "Network request failed", which is true but useless.
 */
export function describeApiError(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof ApiError) return error.messages.join("\n");
  if (error instanceof ApiConfigError) return error.message;
  if (error instanceof TypeError) {
    return "Could not reach the server. Check your connection and that the API is running.";
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
