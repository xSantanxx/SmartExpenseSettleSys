/**
 * Central env config. Fail fast on missing secrets in production;
 * use a fixed default only for local/test so embedded-Postgres tests work.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: () => required("DATABASE_URL"),
  jwtSecret: () =>
    required(
      "JWT_SECRET",
      // Dev/test only — never ship with this default in a real deploy.
      process.env.NODE_ENV === "production"
        ? undefined
        : "dev-only-change-me-sess-jwt-secret"
    ),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  /** bcrypt cost factor — 10 default; tests set BCRYPT_ROUNDS=4 for speed. */
  bcryptRounds: () => Number(process.env.BCRYPT_ROUNDS ?? 10),
  /**
   * Comma-separated browser origins allowed to call the API.
   * Example: https://smart-expense.vercel.app
   * Trailing slashes are stripped. Empty → allow any origin (dev / easy deploy).
   */
  frontendOrigins: (): string[] => {
    const raw = process.env.FRONTEND_ORIGIN ?? "";
    return raw
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
  },
  /** Protects POST /cron/subscription-reminders */
  cronSecret: () => process.env.CRON_SECRET ?? "",
  /** Optional Resend API key for subscription reminder emails */
  resendApiKey: () => process.env.RESEND_API_KEY ?? "",
  reminderFromEmail: () =>
    process.env.REMINDER_FROM_EMAIL ?? "Smart Expense <onboarding@resend.dev>",
};
