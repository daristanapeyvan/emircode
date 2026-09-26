/** @type {import('tailwindcss').Config} */

/** A color taken from the theme variables in src/index.css, so it follows the light / dark theme. */
const themed = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (family, shades) => Object.fromEntries(shades.map((shade) => [shade, themed(`${family}-${shade}`)]));

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: themed('canvas'),
        // Graphite: the accent of buttons, switches and sliders (the composer keeps its blue).
        accent: {
          DEFAULT: themed('accent'),
          hover: themed('accent-hover'),
          fg: themed('accent-fg'),
        },
        zinc: scale('zinc', [...SHADES.slice(0, 8), '750', '800', '850', '900', '950']),
        red: scale('red', SHADES),
        amber: scale('amber', SHADES),
        emerald: scale('emerald', SHADES),
        blue: scale('blue', SHADES),
        purple: scale('purple', SHADES),
        sky: scale('sky', SHADES),
        teal: scale('teal', SHADES),
        pink: scale('pink', SHADES),
      },
      // Rounder corners than Tailwind's defaults: controls 8px, cards 10px, dialogs and the composer 12px.
      borderRadius: {
        sm: '0.375rem',
        DEFAULT: '0.5rem',
        md: '0.625rem',
        lg: '0.75rem',
        xl: '1rem',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};
