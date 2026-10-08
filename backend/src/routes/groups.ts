import { Router } from "express";
import { dollarsToCents } from "../domain/money.js";
import { param } from "../http/params.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
import * as expenses from "../services/expenses.js";
import * as groups from "../services/groups.js";
import * as settlements from "../services/settlements.js";

export const groupsRouter = Router();

groupsRouter.use(requireUser);

groupsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const group = await groups.createGroup(req.body.name, req.userId);
    res.status(201).json(group);
  })
);

groupsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const list = await groups.listGroupsForUser(req.userId);
    res.json(list);
  })
);

groupsRouter.get(
  "/:groupId",
  asyncHandler(async (req, res) => {
    const group = await groups.getGroup(param(req, "groupId"), req.userId);
    res.json(group);
  })
);

groupsRouter.delete(
  "/:groupId",
  asyncHandler(async (req, res) => {
    await groups.deleteGroup(param(req, "groupId"), req.userId);
    res.status(204).send();
  })
);

groupsRouter.post(
  "/:groupId/members",
  asyncHandler(async (req, res) => {
    const group = await groups.addMember(param(req, "groupId"), req.userId, {
      email: req.body.email,
      userId: req.body.userId,
    });
    res.status(201).json(group);
  })
);

groupsRouter.delete(
  "/:groupId/members/:memberId",
  asyncHandler(async (req, res) => {
    await groups.removeMember(
      param(req, "groupId"),
      req.userId,
      param(req, "memberId")
    );
    res.status(204).send();
  })
);

groupsRouter.post(
  "/:groupId/expenses",
  asyncHandler(async (req, res) => {
    const expense = await expenses.createExpense(
      param(req, "groupId"),
      req.userId,
      {
        description: req.body.description,
        amount: req.body.amount,
        paidByUserId: req.body.paidByUserId,
        expenseDate: req.body.expenseDate,
        splitMethod: req.body.splitMethod,
        participantIds: req.body.participantIds,
        splits: req.body.splits,
      }
    );
    res.status(201).json(expense);
  })
);

groupsRouter.get(
  "/:groupId/expenses",
  asyncHandler(async (req, res) => {
    const minAmount =
      typeof req.query.minAmount === "string"
        ? dollarsToCents(req.query.minAmount)
        : undefined;
    const maxAmount =
      typeof req.query.maxAmount === "string"
        ? dollarsToCents(req.query.maxAmount)
        : undefined;

    const list = await expenses.listExpenses(param(req, "groupId"), req.userId, {
      memberId:
        typeof req.query.memberId === "string" ? req.query.memberId : undefined,
      fromDate:
        typeof req.query.fromDate === "string" ? req.query.fromDate : undefined,
      toDate:
        typeof req.query.toDate === "string" ? req.query.toDate : undefined,
      minAmountCents: minAmount,
      maxAmountCents: maxAmount,
    });
    res.json(list);
  })
);

groupsRouter.get(
  "/:groupId/expenses/:expenseId",
  asyncHandler(async (req, res) => {
    const expense = await expenses.getExpense(
      param(req, "groupId"),
      param(req, "expenseId"),
      req.userId
    );
    res.json(expense);
  })
);

groupsRouter.delete(
  "/:groupId/expenses/:expenseId",
  asyncHandler(async (req, res) => {
    await expenses.deleteExpense(
      param(req, "groupId"),
      param(req, "expenseId"),
      req.userId
    );
    res.status(204).send();
  })
);

groupsRouter.get(
  "/:groupId/balances",
  asyncHandler(async (req, res) => {
    const balances = await expenses.getGroupBalances(
      param(req, "groupId"),
      req.userId
    );
    res.json(balances);
  })
);

groupsRouter.get(
  "/:groupId/settlements",
  asyncHandler(async (req, res) => {
    const status =
      req.query.status === "PENDING" || req.query.status === "COMPLETED"
        ? req.query.status
        : undefined;

    // Refresh PENDING from current expenses + completed history, then list.
    const list = await settlements.getOrRefreshSettlements(
      param(req, "groupId"),
      req.userId
    );
    res.json(status ? list.filter((s) => s.status === status) : list);
  })
);

groupsRouter.get(
  "/:groupId/summary",
  asyncHandler(async (req, res) => {
    const summary = await settlements.getGroupSummary(
      param(req, "groupId"),
      req.userId
    );
    res.json(summary);
  })
);
