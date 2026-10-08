-- Personal contacts list ("friends"). Directed: saving Bob does not
-- automatically save Alice on Bob's side — that matches "save as friend" UX.

CREATE TABLE friendships (
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_user_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, friend_user_id),
  CONSTRAINT friendships_no_self CHECK (user_id <> friend_user_id)
);

CREATE INDEX friendships_friend_user_id_idx ON friendships (friend_user_id);
