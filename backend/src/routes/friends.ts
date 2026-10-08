import { Router } from "express";
import { badRequest } from "../errors/AppError.js";
import { param } from "../http/params.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
import * as friends from "../services/friends.js";

export const friendsRouter = Router();

friendsRouter.use(requireUser);

friendsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const list = await friends.listFriends(req.userId);
    res.json(list);
  })
);

friendsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    let friend;
    if (typeof req.body.email === "string" && req.body.email.trim()) {
      friend = await friends.addFriendByEmail(req.userId, req.body.email);
    } else if (typeof req.body.userId === "string" && req.body.userId.trim()) {
      friend = await friends.addFriendByUserId(req.userId, req.body.userId);
    } else {
      throw badRequest("Provide email or userId");
    }
    res.status(201).json(friend);
  })
);

friendsRouter.delete(
  "/:friendUserId",
  asyncHandler(async (req, res) => {
    await friends.removeFriend(req.userId, param(req, "friendUserId"));
    res.status(204).send();
  })
);
