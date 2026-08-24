/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"IBM Plex Sans"', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f6f8fa',
          100: '#eef0f2',
          200: '#d0d7de',
          300: '#afb8c1',
          400: '#8b949e',
          500: '#656d76',
          600: '#424a53',
          700: '#32383f',
          800: '#24292f',
          900: '#1c2128',
          950: '#0d1117',
        },
        accent: {
          DEFAULT: '#0969da',
          soft: '#4493f8',
          deep: '#0550ae',
        },
        warn: '#9a6700',
        danger: '#cf222e',
      },
    },
  },
  plugins: [],
};
