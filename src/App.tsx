import { Funnel } from "~/components/funnel/funnel";
import type { FunnelTrackingProps } from "~/components/funnel/types";

// In production the host page (pages/funnel.tsx) derived these from the Meta click
// cookies + UTM query params and ran the pixel. Locally they're inert nulls — the
// mock backend ignores them and analytics is disabled.
const tracking: FunnelTrackingProps = {
	fbclid: null,
	fbc: null,
	fbp: null,
	utmSource: null,
	utmMedium: null,
	utmCampaign: null,
	utmContent: null,
	utmTerm: null,
};

export default function App() {
	return <Funnel tracking={tracking} />;
}
