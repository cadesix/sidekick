/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ['"ABC Diatype Rounded"', "ui-rounded", "system-ui", "sans-serif"],
			},
		},
	},
	plugins: [],
};
