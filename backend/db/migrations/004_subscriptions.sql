-- Shared subscriptions within a group (e.g. Netflix split evenly).

CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  billing_day     INTEGER NOT NULL,
  created_by      UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_reminded_period TEXT,

  CONSTRAINT subscriptions_name_not_blank CHECK (char_length(trim(name)) > 0),
  CONSTRAINT subscriptions_amount_positive CHECK (amount_cents > 0),
  -- 1–28 avoids Feb 29 / 30 / 31 edge cases
  CONSTRAINT subscriptions_billing_day_valid CHECK (billing_day BETWEEN 1 AND 28)
);

CREATE INDEX subscriptions_group_id_idx ON subscriptions (group_id);

CREATE TABLE subscription_members (
  subscription_id UUID NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (subscription_id, user_id)
);

CREATE INDEX subscription_members_user_id_idx ON subscription_members (user_id);

-- Who has marked their share paid for a given billing month (YYYY-MM).
CREATE TABLE subscription_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  period_key      TEXT NOT NULL,
  share_cents     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT subscription_payments_share_non_negative CHECK (share_cents >= 0),
  CONSTRAINT subscription_payments_status_valid CHECK (status IN ('PENDING', 'PAID')),
  CONSTRAINT subscription_payments_period_format CHECK (period_key ~ '^\d{4}-\d{2}$'),
  CONSTRAINT subscription_payments_unique_member_period
    UNIQUE (subscription_id, user_id, period_key),
  CONSTRAINT subscription_payments_paid_at_consistent CHECK (
    (status = 'PENDING' AND paid_at IS NULL)
    OR (status = 'PAID' AND paid_at IS NOT NULL)
  )
);

CREATE INDEX subscription_payments_sub_period_idx
  ON subscription_payments (subscription_id, period_key);
