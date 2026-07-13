import { TRPCError } from "@trpc/server";
import { registerInput } from "@sidekick/shared";
import { z } from "zod";
import { accountStatus, createEmailAccount, registerDevice, signInWithEmail } from "../auth";
import { protectedProcedure, publicProcedure, router } from "../trpc";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

export const authRouter = router({
  register: publicProcedure
    .input(registerInput)
    .mutation(({ ctx, input }) => registerDevice(ctx.db, input)),
  status: protectedProcedure.query(({ ctx }) => accountStatus(ctx.db, ctx.userId)),
  createEmailAccount: protectedProcedure
    .input(credentials)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createEmailAccount(ctx.db, { userId: ctx.userId, ...input });
      } catch {
        throw new TRPCError({ code: "CONFLICT", message: "An account already uses that email." });
      }
    }),
  signIn: publicProcedure
    .input(credentials.extend({ deviceId: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const result = await signInWithEmail(ctx.db, input);
      if (!result) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect email or password." });
      }
      return result;
    }),
});
