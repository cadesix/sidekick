import Twilio from "twilio";

/** The SMS seam (context.ts `Services.sms`): Twilio Verify send + check. */
export type SmsSender = {
  sendCode(phone: string): Promise<void>;
  verifyCode(phone: string, code: string): Promise<boolean>;
};

/**
 * Twilio Verify implementation of the SMS seam (19-auth.md, ported from
 * scaleshot). Twilio generates, sends, tracks, and validates the code — no local
 * OTP table. The client is built lazily and cached; unconfigured env throws a
 * clear error at call time, not at boot.
 */
export function createTwilioSms(): SmsSender {
  let cachedClient: ReturnType<typeof Twilio> | null = null;

  function getServiceSid(): string {
    const sid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!sid) {
      throw new Error("TWILIO_VERIFY_SERVICE_SID is not set");
    }
    return sid;
  }

  function getClient(): ReturnType<typeof Twilio> {
    if (cachedClient) {
      return cachedClient;
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
    }
    cachedClient = Twilio(accountSid, authToken);
    return cachedClient;
  }

  return {
    async sendCode(phone) {
      await getClient()
        .verify.v2.services(getServiceSid())
        .verifications.create({ to: phone, channel: "sms" });
    },
    async verifyCode(phone, code) {
      const check = await getClient()
        .verify.v2.services(getServiceSid())
        .verificationChecks.create({ to: phone, code });
      return check.status === "approved";
    },
  };
}
