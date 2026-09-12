/**
 * The act-as cookie's name and lifetime — in a module with NO node imports.
 *
 * `impersonation.ts` signs the cookie with node's `crypto`, which the edge
 * runtime cannot load, and middleware (edge) has to know the cookie's name to
 * slide its expiry forward. One home for the two constants both sides need.
 */

export const ACT_AS_COOKIE = "pt-act-as";

/**
 * 12 hours, and middleware slides it forward on every authenticated request.
 *
 * It used to be 12 hours flat from the moment it was issued, so a working day
 * dropped Mason back into his own (empty) admin account mid-session — "I keep
 * getting kicked out of the Two Dudes page… multiple times a day when I
 * reload" (2026-09-11). Sliding it costs nothing: `getAuthUser` re-checks
 * `is_admin` on the REAL session for every request, so a cookie that lives
 * longer grants nothing on its own.
 */
export const ACT_AS_MAX_AGE = 60 * 60 * 12;
