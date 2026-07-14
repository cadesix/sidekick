import { Funnel } from "~/components/funnel/funnel";
import Admin from "./admin";
import Home from "./home";
import Home2 from "./home2";
import Home3 from "./home3";
import Home4 from "./home4";
import Onboarding from "./onboarding";
import Vista from "./vista";
import Sidekick3D from "./sidekick-3d";
import SidekickStudio from "./sidekick-studio";
import PoseStudio from "./pose-studio";
import BiomesPreview from "./biomes-preview";
import ItemRender from "./item-render";
import AssetManager from "./asset-manager";

// Minimal path routing: /home and /home2 show post-funnel home variants, /sidekick is the
// character-iteration studio, /admin is the dev-only admin hub (Chat Lab + Studio),
// everything else (/, /quiz) shows the funnel. (Vite's dev server serves index.html for any path.)
export default function App() {
	const path = typeof window !== "undefined" ? window.location.pathname : "/";
	// Dev-only: admin tools hub. Never shipped to production.
	if (import.meta.env.DEV && path.startsWith("/admin")) {
		return <Admin />;
	}
	// Dev-only: renders every shop product to public/shop-renders (see file docs)
	if (import.meta.env.DEV && path === "/item-render") {
		return <ItemRender />;
	}
	// Dev-only: cosmetics asset catalog + 3D workbench (see file docs)
	if (import.meta.env.DEV && path === "/asset-manager") {
		return <AssetManager />;
	}
	if (path === "/sidekick-3d") {
		return <Sidekick3D />;
	}
	if (path === "/pose") {
		return <PoseStudio />;
	}
	if (path === "/biomes") {
		return <BiomesPreview />;
	}
	if (path === "/sidekick") {
		return <SidekickStudio />;
	}
	if (path === "/vista") {
		return <Vista />;
	}
	if (path === "/onboarding") {
		return <Onboarding />;
	}
	if (path === "/home4") {
		return <Home4 />;
	}
	if (path === "/home3") {
		return <Home3 />;
	}
	if (path === "/home2") {
		return <Home2 />;
	}
	if (path === "/home") {
		return <Home />;
	}
	return <Funnel />;
}
