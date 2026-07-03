/** Tailwind v4 runs as a PostCSS plugin (no tailwind.config.js — tokens live in @app/ui/theme.css). */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
