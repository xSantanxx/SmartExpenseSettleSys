-- Reference query: per-member paid / share / net for a group.
-- Implemented in TypeScript in Stage 3/4; kept here as documentation.
--
-- :group_id UUID

WITH members AS (
  SELECT user_id
  FROM group_members
  WHERE group_id = :group_id
),
paid AS (
  SELECT e.paid_by AS user_id, COALESCE(SUM(e.amount_cents), 0)::INTEGER AS paid_cents
  FROM expenses e
  WHERE e.group_id = :group_id
  GROUP BY e.paid_by
),
share AS (
  SELECT ep.user_id, COALESCE(SUM(ep.share_cents), 0)::INTEGER AS share_cents
  FROM expense_participants ep
  INNER JOIN expenses e ON e.id = ep.expense_id
  WHERE e.group_id = :group_id
  GROUP BY ep.user_id
)
SELECT
  m.user_id,
  COALESCE(p.paid_cents, 0) AS paid_cents,
  COALESCE(s.share_cents, 0) AS share_cents,
  COALESCE(p.paid_cents, 0) - COALESCE(s.share_cents, 0) AS net_cents
FROM members m
LEFT JOIN paid p ON p.user_id = m.user_id
LEFT JOIN share s ON s.user_id = m.user_id
ORDER BY m.user_id;
