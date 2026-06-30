import { Funnel } from "~/components/funnel/funnel";
import Home from "./home";
import Home2 from "./home2";
import SidekickStudio from "./sidekick-studio";

// Minimal path routing: /home and /home2 show post-funnel home variants, /sidekick is the
// character-iteration studio, everything else (/, /quiz) shows the funnel. (Vite's dev
// server serves index.html for any path.)
export default function App() {
	const path = typeof window !== "undefined" ? window.location.pathname : "/";
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
