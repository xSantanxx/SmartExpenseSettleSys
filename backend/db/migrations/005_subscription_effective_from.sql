-- Late joiners start splitting only from their effective_from_period onward
-- (typically the period that begins on the next billing date).

ALTER TABLE subscription_members
  ADD COLUMN IF NOT EXISTS effective_from_period TEXT NOT NULL DEFAULT '1970-01';

ALTER TABLE subscription_members
  DROP CONSTRAINT IF EXISTS subscription_members_effective_period_format;

ALTER TABLE subscription_members
  ADD CONSTRAINT subscription_members_effective_period_format
  CHECK (effective_from_period ~ '^\d{4}-\d{2}$');
