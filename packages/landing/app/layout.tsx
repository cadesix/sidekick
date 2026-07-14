import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Sidekick — A little help becoming your best self",
	description:
		"A friendly AI companion that remembers what matters, checks in, and helps you follow through.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
