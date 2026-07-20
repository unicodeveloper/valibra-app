/**
 * Tailwind is here for exactly one reason: Streamdown ships its component
 * styles as Tailwind utility classes, so without a Tailwind pipeline its code
 * blocks and controls render as bare markup. See the import block at the top of
 * globals.css — the design system itself is hand-written and stays that way.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
