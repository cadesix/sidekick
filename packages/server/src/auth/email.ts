import crypto from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { type Database, emailVerificationCodes } from "@sidekick/db";
import { hashSha256 } from "./sessions";

/** The email seam (context.ts `Services.authEmail`): deliver a one-time code. */
export type AuthEmailSender = {
  sendOtp(email: string, code: string): Promise<void>;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Issue a fresh 6-digit email OTP (19-auth.md). Any prior un-consumed code for the
 * address is invalidated first, so only the newest code can verify; the new code
 * is hashed at rest and delivered through the sender seam.
 */
export async function requestEmailCode(
  db: Database,
  email: string,
  sender: AuthEmailSender,
): Promise<void> {
  await db
    .update(emailVerificationCodes)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        isNull(emailVerificationCodes.consumedAt),
        isNull(emailVerificationCodes.invalidatedAt),
      ),
    );

  const code = crypto.randomInt(100000, 999999).toString();
  await db.insert(emailVerificationCodes).values({
    email,
    hashedCode: hashSha256(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  await sender.sendOtp(email, code);
}

/**
 * Atomically consume the email OTP: a single conditional `UPDATE … RETURNING`
 * marks the live, unexpired, un-invalidated code consumed only while `attempts`
 * is under the cap. A miss bumps `attempts` (throttling brute force) and returns
 * false; a consumed code can never be reused.
 */
export async function consumeEmailCode(
  db: Database,
  email: string,
  code: string,
): Promise<boolean> {
  const now = new Date();
  const consumed = await db
    .update(emailVerificationCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        eq(emailVerificationCodes.hashedCode, hashSha256(code)),
        gt(emailVerificationCodes.expiresAt, now),
        isNull(emailVerificationCodes.consumedAt),
        isNull(emailVerificationCodes.invalidatedAt),
        sql`${emailVerificationCodes.attempts} < ${MAX_ATTEMPTS}`,
      ),
    )
    .returning({ id: emailVerificationCodes.id });

  if (consumed.length > 0) {
    return true;
  }

  await db
    .update(emailVerificationCodes)
    .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        isNull(emailVerificationCodes.consumedAt),
        isNull(emailVerificationCodes.invalidatedAt),
        gt(emailVerificationCodes.expiresAt, now),
      ),
    );

  return false;
}

/** OTP email body (19-auth.md), a plain HTML string ported from invoice's react-email template. */
export function otpEmailHtml(code: string): string {
  return `<!doctype html>
<html>
  <body style="background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">
    <div style="max-width:480px;margin:32px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;text-align:center;">
      <div style="font-size:40px;margin:24px 0;">🔑</div>
      <h1 style="font-size:24px;font-weight:400;margin:0;">Your verification code</h1>
      <div style="font-size:36px;font-weight:700;letter-spacing:0.3em;font-family:monospace;margin:24px 0;">${code}</div>
      <p style="color:#6b7280;font-size:12px;max-width:360px;margin:16px auto 0;">
        This code expires in 10 minutes. If you didn't request this code, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`;
}
