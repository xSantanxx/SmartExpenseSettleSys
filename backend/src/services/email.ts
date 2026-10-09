import { config } from "../config.js";

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

/**
 * Send via Resend when RESEND_API_KEY is set.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const result = await sendEmailDetailed(opts);
  return result.ok;
}

export async function sendEmailDetailed(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendEmailResult> {
  const apiKey = config.resendApiKey();
  const from = config.reminderFromEmail();
  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY not configured" };
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
    return { ok: false, status: res.status, error: body.slice(0, 500) };
  }
  return { ok: true, status: res.status };
}
