import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";
import { signAccessToken, verifyAccessToken } from "./tokens.js";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("password123");
    expect(hash).not.toContain("password123");
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
    expect(await verifyPassword("password123", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects legacy plaintext Stage-3 markers", async () => {
    expect(
      await verifyPassword(
        "password123",
        "plaintext-pending-stage6:password123"
      )
    ).toBe(false);
  });
});

describe("JWT access tokens", () => {
  it("round-trips user id and email", () => {
    const token = signAccessToken(
      "11111111-1111-4111-8111-111111111111",
      "alice@example.com"
    );
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload.email).toBe("alice@example.com");
  });

  it("rejects tampered tokens", () => {
    const token = signAccessToken(
      "11111111-1111-4111-8111-111111111111",
      "alice@example.com"
    );
    expect(() => verifyAccessToken(token + "x")).toThrow();
  });
});
