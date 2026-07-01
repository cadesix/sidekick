import { Funnel } from "~/components/funnel/funnel";
import Admin from "./admin";
import Home from "./home";
import Home2 from "./home2";
import SidekickStudio from "./sidekick-studio";

// Minimal path routing: /home and /home2 show post-funnel home variants, /sidekick is the
// character-iteration studio, /admin is the dev-only admin hub (Chat Lab + Studio),
// everything else (/, /quiz) shows the funnel. (Vite's dev server serves index.html for any path.)
export default function App() {
	const path = typeof window !== "undefined" ? window.location.pathname : "/";
	// Dev-only: admin tools hub. Never shipped to production.
	if (import.meta.env.DEV && path.startsWith("/admin")) {
		return <Admin />;
	}
	if (path === "/sidekick") {
		return <SidekickStudio />;
	}
	if (path === "/home2") {
		return <Home2 />;
	}
	if (path === "/home") {
		return <Home />;
	}
	return <Funnel />;
}
