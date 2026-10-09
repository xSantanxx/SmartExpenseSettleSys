import { config } from "../config.js";

/**
 * Send via Resend when RESEND_API_KEY is set. Returns false if skipped or failed.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const apiKey = config.resendApiKey();
  const from = config.reminderFromEmail();
  if (!apiKey || !from) {
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Resend error:", res.status, body);
    return false;
  }
  return true;
}
