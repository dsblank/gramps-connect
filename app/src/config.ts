// See .env.example -- defaults point at layer3-sync's Postgres-backed
// fixture + relay, the only one of the Layer 2/3 fixtures with live sync
// wired up.
export const API_BASE: string = import.meta.env.VITE_API_BASE;
export const WS_URL: string = import.meta.env.VITE_WS_URL;

// The Postgres-internal integer treeid the trigger payload carries (see
// ../layer3-sync/triggers.sql) -- *not* the tree's UUID gramps-web-api
// itself uses in URLs/JWTs, a separate identifier. Hardcoded because the
// fixture only ever has the one tree; a real multi-tree client would need
// to learn this from the server rather than assume it.
export const MY_TREE_ID = 2;

// Live sync is scoped to this one view for now -- see
// store/liveSync.ts's shouldApplyNotification.
export const LIVE_SYNC_VIEW_KEY = "person";
