import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  const app = createApp();

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects protected routes without a Bearer token", async () => {
    const res = await request(app).get("/groups");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
  });
});
