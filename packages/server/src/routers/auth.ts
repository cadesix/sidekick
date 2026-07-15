import { registerInput } from "@sidekick/shared";
import { registerDevice } from "../auth";
import { publicProcedure, router } from "../trpc";

export const authRouter = router({
  register: publicProcedure
    .input(registerInput)
    .mutation(({ ctx, input }) => registerDevice(ctx.db, input)),
});
