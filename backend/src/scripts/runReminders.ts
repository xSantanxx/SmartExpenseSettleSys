/**
 * Local/manual: npm run reminders:run
 * Requires DATABASE_URL + RESEND_API_KEY in backend/.env
 */
import { closePool } from "../db/pool.js";
import { runSubscriptionReminders } from "../services/subscriptionReminders.js";

const result = await runSubscriptionReminders();
console.log(JSON.stringify(result, null, 2));
await closePool();
