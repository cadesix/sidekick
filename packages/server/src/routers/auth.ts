import { TRPCError } from "@trpc/server";
import {
  appleAuthInput,
  emailAuthInput,
  googleAuthInput,
  phoneAuthInput,
  registerDeviceInput,
  verifyEmailCodeInput,
  verifyPhoneCodeInput,
} from "@sidekick/shared";
import { verifyAppleToken } from "../auth/apple";
import { devLogin } from "../auth/dev-login";
import { consumeEmailCode, requestEmailCode } from "../auth/email";
import { verifyGoogleIdToken } from "../auth/google";
import {
  findOrCreateUserForProvider,
  type ProviderIdentity,
} from "../auth/provider-user";
import { emailRequestLimiter, phoneRequestLimiter } from "../auth/rate-limit";
import { registerDevice } from "../auth/register-device";
import { createSession, revokeSession } from "../auth/sessions";
import type { AppContext } from "../context";
import { protectedProcedure, publicProcedure, router } from "../trpc";

/** Mint a session for a resolved identity — the shared return of every auth mutation. */
async function issueSession(
  ctx: AppContext,
  identity: ProviderIdentity,
): Promise<{ token: string; userId: string; isNewUser: boolean }> {
  const { userId, isNewUser } = await findOrCreateUserForProvider(ctx.db, identity);
  const { token } = await createSession(ctx.db, userId);
  return { token, userId, isNewUser };
}

export const authRouter = router({
  authenticateWithApple: publicProcedure
    .input(appleAuthInput)
    .mutation(async ({ ctx, input }) => {
      const verified = await verifyAppleToken(input.identityToken);
      return issueSession(ctx, {
        provider: "apple",
        providerAccountId: verified.sub,
        email: verified.email,
        emailVerified: verified.emailVerified,
      });
    }),

  authenticateWithGoogle: publicProcedure
    .input(googleAuthInput)
    .mutation(async ({ ctx, input }) => {
      const verified = await verifyGoogleIdToken(input.idToken);
      return issueSession(ctx, {
        provider: "google",
        providerAccountId: verified.sub,
        email: verified.email,
        emailVerified: verified.emailVerified,
      });
    }),

  requestEmailCode: publicProcedure.input(emailAuthInput).mutation(async ({ ctx, input }) => {
    const email = input.email.toLowerCase();
    if (!emailRequestLimiter.consume(email)) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many code requests. Please wait a few minutes.",
      });
    }
    await requestEmailCode(ctx.db, email, ctx.authEmail);
    return { ok: true };
  }),

  verifyEmailCode: publicProcedure.input(verifyEmailCodeInput).mutation(async ({ ctx, input }) => {
    const email = input.email.toLowerCase();
    const ok = await consumeEmailCode(ctx.db, email, input.code);
    if (!ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired code." });
    }
    return issueSession(ctx, {
      provider: "email",
      providerAccountId: email,
      email,
      emailVerified: true,
    });
  }),

  requestPhoneCode: publicProcedure.input(phoneAuthInput).mutation(async ({ ctx, input }) => {
    if (!phoneRequestLimiter.consume(input.phone)) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many code requests. Please wait a while.",
      });
    }
    await ctx.sms.sendCode(input.phone);
    return { ok: true };
  }),

  verifyPhoneCode: publicProcedure.input(verifyPhoneCodeInput).mutation(async ({ ctx, input }) => {
    const approved = await ctx.sms.verifyCode(input.phone, input.code);
    if (!approved) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Incorrect code." });
    }
    return issueSession(ctx, {
      provider: "phone",
      providerAccountId: input.phone,
      phone: input.phone,
    });
  }),

  devLogin: publicProcedure.mutation(({ ctx }) => devLogin(ctx.db)),

  registerDevice: protectedProcedure.input(registerDeviceInput).mutation(async ({ ctx, input }) => {
    await registerDevice(ctx.db, ctx.userId, input);
    return { ok: true };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.sessionId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    await revokeSession(ctx.db, ctx.sessionId);
    return { ok: true };
  }),
});
