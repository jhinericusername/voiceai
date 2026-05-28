-- 002_candidate_invites.sql — opaque candidate interview links.

CREATE TABLE candidate_invites (
  invite_id       TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  candidate_email TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active',
  not_before      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  join_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX candidate_invites_session_idx ON candidate_invites(session_id);
CREATE INDEX candidate_invites_expires_at_idx ON candidate_invites(expires_at);
