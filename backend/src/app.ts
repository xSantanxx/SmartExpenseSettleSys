import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { friendsRouter } from "./routes/friends.js";
import { groupsRouter } from "./routes/groups.js";
import { settlementsRouter } from "./routes/settlements.js";
import { usersRouter } from "./routes/users.js";

/**
 * Express application factory — no listen() here so tests can import the app
 * without opening a port.
 */
export function createApp() {
  const app = express();

  const allowed = config.frontendOrigins();
  app.use(
    cors({
      origin:
        allowed.length === 0
          ? true // local/dev: allow Vite / curl
          : (origin, callback) => {
              // Non-browser clients (no Origin) and allowlisted frontends.
              if (!origin || allowed.includes(origin)) {
                callback(null, true);
                return;
              }
              callback(new Error(`Origin ${origin} not allowed by CORS`));
            },
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter);
  app.use("/users", usersRouter);
  app.use("/friends", friendsRouter);
  app.use("/groups", groupsRouter);
  app.use("/settlements", settlementsRouter);

  // 404 for unknown routes
  app.use((_req, res) => {
    res.status(404).json({
      error: { message: "Route not found", code: "NOT_FOUND" },
    });
  });

  app.use(errorHandler);
  return app;
}
