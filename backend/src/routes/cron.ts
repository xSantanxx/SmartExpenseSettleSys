import { Router } from "express";
import { config } from "../config.js";
import { unauthorized } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { runSubscriptionReminders } from "../services/subscriptionReminders.js";

export const cronRouter = Router();

/**
 * POST /cron/subscription-reminders
 * Header: X-Cron-Secret: <CRON_SECRET>
 *
 * Point a daily Render Cron Job (or GitHub Action) at this URL.
 */
cronRouter.post(
  "/subscription-reminders",
  asyncHandler(async (req, res) => {
    const expected = config.cronSecret();
    const provided = req.header("x-cron-secret") ?? "";
    if (!expected || provided !== expected) {
      throw unauthorized("Invalid cron secret");
    }
    const result = await runSubscriptionReminders();
    res.json(result);
  })
);
