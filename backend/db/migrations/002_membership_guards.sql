-- Defense in depth: ensure payers / participants / settlement parties
-- belong to the expense's group. The API validates this too; these
-- triggers catch bugs that bypass application code.

CREATE OR REPLACE FUNCTION assert_user_is_group_member(
  p_group_id UUID,
  p_user_id UUID,
  p_role TEXT
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM group_members
    WHERE group_id = p_group_id
      AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '% must be a member of group %', p_role, p_group_id
      USING ERRCODE = '23514'; -- check_violation
  END IF;
END;
$$ LANGUAGE plpgsql;

-- expenses.paid_by and expenses.created_by must be members
CREATE OR REPLACE FUNCTION expenses_membership_guard()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_user_is_group_member(NEW.group_id, NEW.paid_by, 'payer');
  PERFORM assert_user_is_group_member(NEW.group_id, NEW.created_by, 'creator');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_membership_guard_trg
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION expenses_membership_guard();

-- expense_participants.user_id must be a member of the expense's group
CREATE OR REPLACE FUNCTION expense_participants_membership_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_group_id UUID;
BEGIN
  SELECT group_id INTO v_group_id FROM expenses WHERE id = NEW.expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'expense % does not exist', NEW.expense_id
      USING ERRCODE = '23503';
  END IF;
  PERFORM assert_user_is_group_member(v_group_id, NEW.user_id, 'participant');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_participants_membership_guard_trg
  BEFORE INSERT OR UPDATE ON expense_participants
  FOR EACH ROW
  EXECUTE FUNCTION expense_participants_membership_guard();

-- settlement parties must belong to the group
CREATE OR REPLACE FUNCTION settlements_membership_guard()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_user_is_group_member(NEW.group_id, NEW.from_user_id, 'settlement debtor');
  PERFORM assert_user_is_group_member(NEW.group_id, NEW.to_user_id, 'settlement creditor');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settlements_membership_guard_trg
  BEFORE INSERT OR UPDATE ON settlements
  FOR EACH ROW
  EXECUTE FUNCTION settlements_membership_guard();
