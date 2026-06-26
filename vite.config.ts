import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// This funnel was lifted out of a Next.js monorepo. To let every component copy
// over verbatim, the backend/framework boundary is replaced with local shims via
// these aliases, and the funnel's `process.env.NEXT_PUBLIC_*` reads are inlined
// at build time below.
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"~": fileURLToPath(new URL("./src", import.meta.url)),
			// next/image -> plain <img> shim (no Next runtime here)
			"next/image": fileURLToPath(new URL("./src/shims/next-image.tsx", import.meta.url)),
			// posthog-js -> no-op proxy (analytics disabled locally)
			"posthog-js": fileURLToPath(new URL("./src/shims/posthog.ts", import.meta.url)),
			// @sans/api was a type-only import; provide the minimal types it used
			"@sans/api": fileURLToPath(new URL("./src/lib/sans-api-types.ts", import.meta.url)),
		},
	},
	define: {
		"process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID": JSON.stringify(""),
		"process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": JSON.stringify(""),
		"process.env.NEXT_PUBLIC_STRIPE_TRIAL_DAYS": JSON.stringify("3"),
		"process.env.NEXT_PUBLIC_LAUNCH_PROMO_CODE": JSON.stringify("LAUNCH"),
		"process.env.NEXT_PUBLIC_APP_STORE_RATING": JSON.stringify("4.7"),
		"process.env.NEXT_PUBLIC_COLLECTOR_COUNT": JSON.stringify("230,000+"),
		"process.env.NEXT_PUBLIC_SCANNED_VALUE": JSON.stringify("$50M+"),
	},
	server: { port: 3100 },
});
