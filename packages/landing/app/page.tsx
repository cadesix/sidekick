import Image from "next/image";
import Link from "next/link";

const promises = [
	{
		title: "Remembers the real stuff",
		body: "Your goals, your routines, the thing you said you would do Tuesday. Sidekick keeps the thread going.",
		icon: "✦",
	},
	{
		title: "Actually checks in",
		body: "A gentle nudge when you need one, a tiny celebration when you show up, and no guilt when life happens.",
		icon: "↗",
	},
	{
		title: "Feels like your person",
		body: "Customize your companion, chat naturally, and get support that sounds human—not like a productivity manual.",
		icon: "☺",
	},
];

export default function Home() {
	return (
		<main className="landing-page">
			<nav className="nav" aria-label="Main navigation">
				<Link className="wordmark" href="/" aria-label="Sidekick home">
					<Image
						className="wordmark-icon"
						src="/sidekick-icon.png"
						alt=""
						width={36}
						height={36}
					/>
					Sidekick
				</Link>
				<a className="nav-cta" href="#get-sidekick">
					Get Sidekick
				</a>
			</nav>

			<section className="hero">
				<div className="hero-copy">
					<p className="eyebrow">YOUR AI ACCOUNTABILITY BUDDY</p>
					<h1>A little help becoming who you want to be.</h1>
					<p className="hero-intro">
						Sidekick remembers what matters, checks in, and helps you follow through—one honest
						conversation at a time.
					</p>
					<a className="primary-button" href="#get-sidekick">
						Meet your Sidekick <span aria-hidden="true">→</span>
					</a>
					<p className="tiny-note">Coming soon to iOS and Android</p>
				</div>

				<div className="hero-art" aria-label="The Sidekick character sitting and smiling">
					<div className="orbit orbit-one" />
					<div className="orbit orbit-two" />
					<div className="speech-bubble bubble-one">you&apos;ve got this</div>
					<div className="speech-bubble bubble-two">tiny steps count ✦</div>
					<Image
						className="sidekick-image"
						src="/sidekick-sitting.png"
						alt="A cheerful golden Sidekick character"
						width={1536}
						height={1024}
						priority
					/>
				</div>
			</section>

			<section className="promise-section" aria-labelledby="promise-title">
				<p className="eyebrow centered">SMALL MOMENTS, REAL MOMENTUM</p>
				<h2 id="promise-title">More than a chatbot.<br />Someone in your corner.</h2>
				<div className="promise-grid">
					{promises.map((promise) => (
						<article className="promise-card" key={promise.title}>
							<span className="promise-icon" aria-hidden="true">{promise.icon}</span>
							<h3>{promise.title}</h3>
							<p>{promise.body}</p>
						</article>
					))}
				</div>
			</section>

			<section className="chat-section">
				<div className="chat-copy">
					<p className="eyebrow">IT STARTS WITH A CHAT</p>
					<h2>Tell Sidekick what you&apos;re working on.</h2>
					<p>
						Building a habit. Getting unstuck. Feeling less alone in it. Sidekick gets to know
						you and turns the big thing into the next doable thing.
					</p>
				</div>
				<div className="phone" aria-label="Example chat with Sidekick">
					<div className="phone-top"><span /><strong>Sidekick</strong><span>•••</span></div>
					<div className="messages">
						<p className="message sidekick-message">hey! how&apos;d the run go?</p>
						<p className="message user-message">i almost skipped it, but did 20 min</p>
						<p className="message sidekick-message">20 min on a day you almost skipped? huge. proud of u 🧡</p>
					</div>
					<div className="composer">Message Sidekick <span>↑</span></div>
				</div>
			</section>

			<section className="final-cta" id="get-sidekick">
				<Image
					className="app-icon"
					src="/sidekick-icon.png"
					alt="Sidekick app icon"
					width={140}
					height={140}
				/>
				<h2>Your new favorite person<br />is almost here.</h2>
				<p>Sidekick is coming soon to iOS and Android.</p>
				<a className="primary-button light-button" href="mailto:hello@sidekickchat.app?subject=Sidekick%20launch">
					Get launch updates <span aria-hidden="true">→</span>
				</a>
			</section>

			<footer>
				<Link className="wordmark" href="/">
					<Image
						className="wordmark-icon"
						src="/sidekick-icon.png"
						alt=""
						width={36}
						height={36}
					/>
					Sidekick
				</Link>
				<div className="footer-links">
					<Link href="/terms">Terms</Link>
					<Link href="/privacy">Privacy</Link>
					<a href="mailto:hello@sidekickchat.app">Contact</a>
				</div>
				<p>© {new Date().getFullYear()} Sans Software LLC</p>
			</footer>
		</main>
	);
}
