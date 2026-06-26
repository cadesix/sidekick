import Image from "next/image";
import posthog from "posthog-js";
import { useCallback, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { identifyOnce } from "~/utils/posthog";
import { api } from "~/utils/trpc";
import { ILLUSTRATIONS } from "./illustrations";
import { StepHeader } from "./step-header";
import type { FunnelAnswers } from "./types";

function getGoogleOAuthUrl(funnelStep: number, funnelAnswers: FunnelAnswers) {
	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	const stateRandom = crypto.randomUUID();

	const state = btoa(
		JSON.stringify({
			stateRandom,
			funnelStep,
			funnelAnswers,
		}),
	);

	url.searchParams.append("response_type", "code");
	url.searchParams.append("client_id", process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!);
	url.searchParams.append(
		"scope",
		[
			"https://www.googleapis.com/auth/userinfo.profile",
			"https://www.googleapis.com/auth/userinfo.email",
		].join(" "),
	);
	url.searchParams.append("state", state);
	url.searchParams.append("redirect_uri", `${window.location.origin}/oauth/google/callback/auth`);
	url.searchParams.append("access_type", "offline");

	return { url: url.toString(), state };
}

export function AuthStep({
	onAuthenticated,
	stepIndex,
	answers,
}: {
	onAuthenticated: (data: { userId: string; email: string }) => void;
	stepIndex: number;
	answers: FunnelAnswers;
}) {
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [step, setStep] = useState<"choose" | "email" | "code">("choose");
	const [error, setError] = useState<string | null>(null);

	const requestCode = api.auth.requestEmailCode.useMutation();
	const verifyCode = api.auth.verifyEmailCode.useMutation();

	const handleGoogleSignIn = useCallback(() => {
		const { url, state } = getGoogleOAuthUrl(stepIndex + 1, answers);
		sessionStorage.setItem("oauth_state", state);
		window.location.href = url;
	}, [stepIndex, answers]);

	const handleSendCode = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError(null);
			try {
				await requestCode.mutateAsync({ email });
				setStep("code");
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : "Failed to send code";
				setError(message);
			}
		},
		[email, requestCode],
	);

	const handleVerifyCode = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError(null);
			try {
				const result = await verifyCode.mutateAsync({ email, code });
				identifyOnce(posthog, result.userId, { email });
				onAuthenticated({
					userId: result.userId,
					email,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : "Invalid or expired code";
				setError(message);
			}
		},
		[email, code, verifyCode, onAuthenticated],
	);

	return (
		<div className="flex flex-col max-h-full">
			{step === "code" ? (
				<StepHeader title="Check your inbox" subtitle={`We sent a 6-digit code to ${email}`} />
			) : (
				<div className="px-6 pt-7 pb-2 shrink-0 text-center">
					<h2 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-stone-900">
						Your free trial is live!
					</h2>
					<Image
						src={ILLUSTRATIONS.chest.src}
						alt={ILLUSTRATIONS.chest.alt}
						width={ILLUSTRATIONS.chest.width}
						height={ILLUSTRATIONS.chest.height}
						priority
						unoptimized
						className="my-3 h-36 w-auto mx-auto animate-scale-in"
					/>
					<p className="text-[14px] leading-relaxed text-stone-500 mb-3">
						Enter your email so you don&apos;t lose access to Relic
					</p>
				</div>
			)}

			<div className="overflow-y-auto min-h-0 px-6 pb-7 flex flex-col gap-6">
				{step === "code" ? (
					<form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
						<input
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							placeholder="000000"
							required
							autoFocus
							className="w-full px-4 py-3.5 rounded-xl border border-stone-300 bg-white text-center text-2xl font-mono tracking-[0.3em] text-stone-900 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent"
						/>
						{error ? <p className="text-sm text-red-600">{error}</p> : null}
						<button
							type="submit"
							disabled={verifyCode.isPending || code.length !== 6}
							className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{verifyCode.isPending ? "Verifying..." : "Verify"}
						</button>
						<button
							type="button"
							onClick={() => {
								setStep("choose");
								setCode("");
								setError(null);
							}}
							className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
						>
							Use a different method
						</button>
					</form>
				) : step === "email" ? (
					<form onSubmit={handleSendCode} className="flex flex-col gap-4">
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="your@email.com"
							required
							autoFocus
							className="w-full px-4 py-3.5 rounded-xl border border-stone-300 bg-white text-base text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent"
						/>
						{error ? <p className="text-sm text-red-600">{error}</p> : null}
						<button
							type="submit"
							disabled={requestCode.isPending || !email}
							className="w-full py-4 bg-stone-900 hover:bg-stone-800 active:bg-stone-700 text-white text-base font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{requestCode.isPending ? "Sending..." : "Continue with email"}
						</button>
						<button
							type="button"
							onClick={() => {
								setStep("choose");
								setError(null);
							}}
							className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
						>
							Back to sign up options
						</button>
					</form>
				) : (
					<div className="flex flex-col gap-3">
						{process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
							<>
								<button
									type="button"
									onClick={handleGoogleSignIn}
									className="w-full py-3.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 active:bg-stone-100 text-base font-medium text-stone-700 transition-colors flex items-center justify-center gap-3"
								>
									<FcGoogle className="w-5 h-5" />
									Continue with Google
								</button>

								<div className="flex items-center gap-3 my-1">
									<div className="flex-1 h-px bg-stone-200" />
									<span className="text-xs text-stone-400">or</span>
									<div className="flex-1 h-px bg-stone-200" />
								</div>
							</>
						) : null}

						<button
							type="button"
							onClick={() => setStep("email")}
							className="w-full py-3.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 active:bg-stone-100 text-base font-medium text-stone-700 transition-colors"
						>
							Continue with email
						</button>

						{error ? <p className="text-sm text-red-600 text-center">{error}</p> : null}
					</div>
				)}

				<p className="text-xs text-stone-400 text-center">
					By continuing, you agree to our{" "}
					<a
						href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
						target="_blank"
						rel="noopener noreferrer"
						className="underline"
					>
						Terms
					</a>{" "}
					and{" "}
					<a
						href="https://sans.software/relic/privacy"
						target="_blank"
						rel="noopener noreferrer"
						className="underline"
					>
						Privacy Policy
					</a>
				</p>
			</div>
		</div>
	);
}
