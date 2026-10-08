import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
import * as auth from "../services/auth.js";
import * as users from "../services/users.js";

export const authRouter = Router();

/**
 * POST /auth/register
 * Body: { email, displayName, password }
 * → { user, token }
 */
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const result = await auth.register({
      email: req.body.email,
      displayName: req.body.displayName,
      password: req.body.password,
    });
    res.status(201).json(result);
  })
);

/**
 * POST /auth/login
 * Body: { email, password }
 * → { user, token }
 */
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const result = await auth.login({
      email: req.body.email,
      password: req.body.password,
    });
    res.json(result);
  })
);

/** GET /auth/me — current user from JWT */
authRouter.get(
  "/me",
  requireUser,
  asyncHandler(async (req, res) => {
    const user = await users.getUserById(req.userId);
    res.json(user);
  })
);
