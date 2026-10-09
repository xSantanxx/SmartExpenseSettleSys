import { Router } from "express";
import { param } from "../http/params.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
import * as subscriptions from "../services/subscriptions.js";

export const subscriptionsRouter = Router({ mergeParams: true });

subscriptionsRouter.use(requireUser);

/** GET /groups/:groupId/subscriptions */
subscriptionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const list = await subscriptions.listSubscriptions(
      param(req, "groupId"),
      req.userId
    );
    res.json(list);
  })
);

/** POST /groups/:groupId/subscriptions */
subscriptionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const created = await subscriptions.createSubscription(
      param(req, "groupId"),
      req.userId,
      {
        name: req.body.name,
        amount: req.body.amount,
        billingDay: req.body.billingDay,
        memberIds: req.body.memberIds,
      }
    );
    res.status(201).json(created);
  })
);

/** POST /groups/:groupId/subscriptions/:subscriptionId/members */
subscriptionsRouter.post(
  "/:subscriptionId/members",
  asyncHandler(async (req, res) => {
    const updated = await subscriptions.addSubscriptionMember(
      param(req, "subscriptionId"),
      req.userId,
      { email: req.body.email, userId: req.body.userId }
    );
    res.status(201).json(updated);
  })
);

subscriptionsRouter.delete(
  "/:subscriptionId/members/:memberId",
  asyncHandler(async (req, res) => {
    const updated = await subscriptions.removeSubscriptionMember(
      param(req, "subscriptionId"),
      req.userId,
      param(req, "memberId")
    );
    res.json(updated);
  })
);

/** POST /groups/:groupId/subscriptions/:subscriptionId/pay */
subscriptionsRouter.post(
  "/:subscriptionId/pay",
  asyncHandler(async (req, res) => {
    const updated = await subscriptions.markSubscriptionPaid(
      param(req, "subscriptionId"),
      req.userId
    );
    res.json(updated);
  })
);

subscriptionsRouter.delete(
  "/:subscriptionId",
  asyncHandler(async (req, res) => {
    await subscriptions.deactivateSubscription(
      param(req, "subscriptionId"),
      req.userId
    );
    res.status(204).send();
  })
);
