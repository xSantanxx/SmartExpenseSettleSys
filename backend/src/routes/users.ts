import { Router } from "express";
import { config } from "../config.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
import { sendEmailDetailed } from "../services/email.js";
import * as users from "../services/users.js";

/**
 * Lightweight user routes.
 * Registration/login live under /auth (Stage 6).
 */
export const usersRouter = Router();

usersRouter.get(
  "/me",
  requireUser,
  asyncHandler(async (req, res) => {
    const user = await users.getUserById(req.userId);
    res.json(user);
  })
);

/** POST /users/me/test-email — verify Resend delivers to your account email */
usersRouter.post(
  "/me/test-email",
  requireUser,
  asyncHandler(async (req, res) => {
    const user = await users.getUserById(req.userId);
    const configured = Boolean(config.resendApiKey());
    const result = await sendEmailDetailed({
      to: user.email,
      subject: "Smart Expense — test email",
      text:
        `Hi ${user.displayName},\n\n` +
        `This is a test from Smart Expense Settlement. Resend is working.\n`,
    });
    res.json({
      to: user.email,
      configured,
      from: config.reminderFromEmail(),
      sent: result.ok,
      skipped: result.skipped ?? false,
      resendStatus: result.status ?? null,
      error: result.error ?? null,
      hint: result.ok
        ? "Check inbox (and spam). On Resend free tier, you can usually only send TO the email you signed up with until you verify a domain."
        : undefined,
    });
  })
);
