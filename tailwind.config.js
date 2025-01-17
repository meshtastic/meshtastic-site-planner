/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ["class", '[data-theme="dark"]'],
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {},
	plugins: [require("tailwindcss-animate")],
};
