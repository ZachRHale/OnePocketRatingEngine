/**
 * Layer 1 — Raw Match Data.
 *
 * Branded-ish identifier aliases. They are plain strings at runtime, but the
 * distinct names document intent at every call site and let the type checker
 * flag an obvious mix-up (e.g. passing a MatchId where a PlayerId is wanted)
 * when callers opt into the aliases.
 */
export type PlayerId = string;
export type MatchId = string;
export type GameId = string;
export type SessionId = string;
