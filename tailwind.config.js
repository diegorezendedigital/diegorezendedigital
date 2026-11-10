/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Cor de ação do painel (verde-floresta da marca)
        brand: { DEFAULT: "#0F3D2E", dark: "#0A2C21", light: "#E3EBE5" },
        // Identidade visual da página de apresentação e do login
        ink: "#0F3D2E",
        inkdeep: "#0A2C21",
        paper: "#EEF1EA",
        gold: "#C99A2E",
        goldlight: "#E4C878",
        clay: "#B65E3B",
        line: "#D8DDD0",
        // Cinzas levemente quentes (substituem o cinza-azulado padrão do Tailwind em todo o painel)
        slate: {
          50: "#F8F8F5",
          100: "#F1F1EC",
          200: "#E4E4DC",
          300: "#CFCFC5",
          400: "#A3A399",
          500: "#767669",
          600: "#5A5A50",
          700: "#42423A",
          800: "#2B2B25",
          900: "#1A1A16",
        },
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        body: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
