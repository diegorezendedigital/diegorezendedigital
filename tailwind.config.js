/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0f766e", dark: "#115e59", light: "#ccfbf1" },
        // Identidade visual da página de apresentação e do login
        ink: "#0F3D2E",
        inkdeep: "#0A2C21",
        paper: "#EEF1EA",
        gold: "#C99A2E",
        goldlight: "#E4C878",
        clay: "#B65E3B",
        line: "#D8DDD0",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        body: ["IBM Plex Sans", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
