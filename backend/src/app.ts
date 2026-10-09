import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { cronRouter } from "./routes/cron.js";
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
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      // curl / server-to-server: no Origin header
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = origin.replace(/\/$/, "");
      // Empty allowlist = allow all (simplest for demos). Otherwise exact match.
      if (allowed.length === 0 || allowed.includes(normalized)) {
        callback(null, true);
        return;
      }
      console.warn(
        `CORS blocked origin="${origin}" allowed=[${allowed.join(", ")}]`
      );
      callback(null, false);
    },
  };
  app.use(cors(corsOptions));
  // Express 5 can skip CORS on OPTIONS unless we register it explicitly.
  app.options(/.*/, cors(corsOptions));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter);
  app.use("/users", usersRouter);
  app.use("/friends", friendsRouter);
  app.use("/groups", groupsRouter);
  app.use("/settlements", settlementsRouter);
  app.use("/cron", cronRouter);

  // 404 for unknown routes
  app.use((_req, res) => {
    res.status(404).json({
      error: { message: "Route not found", code: "NOT_FOUND" },
    });
  });

  app.use(errorHandler);
  return app;
}
