/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        cream: "#FBEFC9",
        sun: "#F2C94C",
        sky: "#9DC4F2",
        usergray: "#E9E9EC",
        field: "#F0F0F2",
        flame: "#FF9F43",
        butter: "#FBF5D0",
        peach: "#F6D2CB",
        mint: "#DCF3EF",
        lilac: "#F1DAF6",
        periwinkle: "#DCE7FB",
      },
      fontFamily: {
        sans: ["Diatype-Rounded"],
      },
    },
  },
  plugins: [],
};
