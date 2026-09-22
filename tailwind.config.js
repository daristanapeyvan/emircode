/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          dark: '#121316',
          light: '#f9f9fb',
        },
        surface: {
          dark: '#18191d',
          'dark-hover': '#212328',
          'dark-subtle': '#141518',
          light: '#ffffff',
          'light-hover': '#f3f4f6',
          'light-subtle': '#f4f5f8',
        },
        border: {
          dark: '#26282f',
          'dark-subtle': '#1e2025',
          light: '#e5e7eb',
          'light-subtle': '#f0f1f4',
        },
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          subtle: 'rgba(59, 130, 246, 0.1)',
        },
        zinc: {
          750: '#23252b',
          850: '#1b1c21',
        },
      },
      borderColor: {
        DEFAULT: 'rgba(255, 255, 255, 0.08)',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};
