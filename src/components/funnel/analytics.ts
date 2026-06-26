import posthog from "posthog-js";
import type { FunnelManifest, PaywallVariant, StepConfig } from "./types";

export interface FunnelContext {
	manifest: FunnelManifest;
	paywallVariant: PaywallVariant;
}

// The versioned envelope stamped on every funnel event. Keeping this in one place
// means a step rename or a funnel-version bump shows up consistently in PostHog and
// historical funnel queries don't silently break across edits.
function envelope(ctx: FunnelContext): Record<string, unknown> {
	return {
		funnel_id: ctx.manifest.funnelId,
		funnel_version: ctx.manifest.funnelVersion,
		funnel_revision_id: ctx.manifest.funnelRevisionId,
		experiment_key: ctx.manifest.experimentKey,
		experiment_variant: ctx.manifest.variantKey,
		paywall_variant: ctx.paywallVariant,
	};
}

export function captureFunnelEvent(
	eventName: string,
	ctx: FunnelContext,
	extra?: Record<string, unknown>,
): void {
	posthog.capture(eventName, { ...envelope(ctx), ...extra });
}

export function captureStepEvent(
	eventName: string,
	ctx: FunnelContext,
	step: StepConfig,
	stepIndex: number,
	extra?: Record<string, unknown>,
): void {
	captureFunnelEvent(eventName, ctx, {
		step_id: step.id,
		step_index: stepIndex,
		step_type: step.type,
		step_role: step.role,
		step_version: step.version ?? 1,
		...extra,
	});
}
