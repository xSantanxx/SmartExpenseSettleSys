import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Embedded Postgres needs a longer first boot; unit tests stay fast.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
