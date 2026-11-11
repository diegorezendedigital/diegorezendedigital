/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Cor de ação do painel (verde-floresta da marca)
        brand: { DEFAULT: "#5B3DF5", dark: "#4A2FD6", light: "#E9E3FF" },
        // Identidade visual da página de apresentação e do login
        ink: "#2A1F85",
        inkdeep: "#1D1660",
        paper: "#F6F3FF",
        gold: "#FFB938",
        goldlight: "#FFE29A",
        clay: "#FF6F59",
        line: "#E4DEFA",
        // Cinzas levemente quentes (substituem o cinza-azulado padrão do Tailwind em todo o painel)
        slate: {
          50: "#F6F3FF",
          100: "#EFEAFF",
          200: "#E4DEFA",
          300: "#D3CBF0",
          400: "#9A94BD",
          500: "#6B6595",
          600: "#55507C",
          700: "#3F3A63",
          800: "#2A2548",
          900: "#1D1840",
        },
      },
      fontFamily: {
        display: ["Outfit", "system-ui", "sans-serif"],
        body: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        card: "0 10px 30px rgba(91, 61, 245, 0.08)",
        soft: "0 2px 10px rgba(91, 61, 245, 0.10)",
      },
    },
  },
  plugins: [],
};
