import { QueryClient } from "@tanstack/react-query";

/**
 * The app's single QueryClient, held at module scope so non-hook code — the 401
 * handler and sign-out in api.ts — can clear the cache without a component in
 * scope. `_layout.tsx` hands this same instance to the provider.
 */
export const queryClient = new QueryClient();
