import { Router } from "express";
import { param } from "../http/params.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireUser } from "../middleware/requireUser.js";
import * as settlements from "../services/settlements.js";

export const settlementsRouter = Router();

settlementsRouter.use(requireUser);

/**
 * PATCH /settlements/:settlementId
 * Body: { "status": "COMPLETED" }
 *
 * Marks a planned payment as done, keeps the row as history, and regenerates
 * remaining PENDING settlements for the group.
 */
settlementsRouter.patch(
  "/:settlementId",
  asyncHandler(async (req, res) => {
    settlements.parseSettlementStatusPatch(req.body);
    const updated = await settlements.markSettlementCompleted(
      param(req, "settlementId"),
      req.userId
    );
    res.json(updated);
  })
);
