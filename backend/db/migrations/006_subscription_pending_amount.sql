-- Schedule a new subscription price that takes effect from pending_from_period.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS pending_from_period TEXT;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_pending_amount_positive;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_pending_amount_positive
  CHECK (pending_amount_cents IS NULL OR pending_amount_cents > 0);

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_pending_period_format;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_pending_period_format
  CHECK (
    pending_from_period IS NULL
    OR pending_from_period ~ '^\d{4}-\d{2}$'
  );

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_pending_pair;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_pending_pair
  CHECK (
    (pending_amount_cents IS NULL AND pending_from_period IS NULL)
    OR (pending_amount_cents IS NOT NULL AND pending_from_period IS NOT NULL)
  );
