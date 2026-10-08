import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
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
