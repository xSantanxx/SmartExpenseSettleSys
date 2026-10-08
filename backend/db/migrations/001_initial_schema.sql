-- Smart Expense Settlement System — initial schema
-- Money: INTEGER cents. AuthZ: group_members is the access control list.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_display_name_not_blank CHECK (char_length(trim(display_name)) > 0)
);

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT groups_name_not_blank CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX groups_created_by_idx ON groups (created_by);

-- ---------------------------------------------------------------------------
-- group_members  (authorization source of truth)
-- ---------------------------------------------------------------------------
CREATE TABLE group_members (
  group_id   UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (group_id, user_id)
);

-- Speeds up "list groups for this user"
CREATE INDEX group_members_user_id_idx ON group_members (user_id);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
CREATE TABLE expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  paid_by       UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  expense_date  DATE NOT NULL,
  split_method  TEXT NOT NULL,
  created_by    UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT expenses_description_not_blank CHECK (char_length(trim(description)) > 0),
  CONSTRAINT expenses_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT expenses_split_method_valid CHECK (
    split_method IN ('EQUAL', 'UNEQUAL', 'PERCENTAGE')
  )
);

CREATE INDEX expenses_group_date_idx ON expenses (group_id, expense_date DESC);

-- ---------------------------------------------------------------------------
-- expense_participants
-- share_cents is always the final computed share (sum must equal amount_cents).
-- split_input holds unequal cents or percentage basis points (10000 = 100%).
-- ---------------------------------------------------------------------------
CREATE TABLE expense_participants (
  expense_id   UUID NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  share_cents  INTEGER NOT NULL,
  split_input  INTEGER,

  PRIMARY KEY (expense_id, user_id),
  CONSTRAINT expense_participants_share_non_negative CHECK (share_cents >= 0),
  CONSTRAINT expense_participants_split_input_non_negative CHECK (
    split_input IS NULL OR split_input >= 0
  )
);

CREATE INDEX expense_participants_user_id_idx ON expense_participants (user_id);

-- ---------------------------------------------------------------------------
-- settlements
-- PENDING rows may be regenerated when expenses change.
-- COMPLETED rows are history and are never deleted by regeneration.
-- ---------------------------------------------------------------------------
CREATE TABLE settlements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  from_user_id   UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  to_user_id     UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,

  CONSTRAINT settlements_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT settlements_status_valid CHECK (status IN ('PENDING', 'COMPLETED')),
  CONSTRAINT settlements_no_self_payment CHECK (from_user_id <> to_user_id),
  CONSTRAINT settlements_completed_at_consistent CHECK (
    (status = 'PENDING' AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX settlements_group_status_idx ON settlements (group_id, status);
