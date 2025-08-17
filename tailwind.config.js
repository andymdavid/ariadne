/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark mode color system from design docs
        bg: {
          primary: '#0d1117',
          secondary: '#161b22',
          tertiary: '#21262d',
        },
        accent: {
          primary: '#58a6ff',
          success: '#238636',
          warning: '#d29922',
          danger: '#f85149',
        },
        text: {
          primary: '#f0f6fc',
          secondary: '#8b949e',
          muted: '#6e7681',
        },
        hover: {
          bg: '#30363d',
        },
        border: {
          default: '#30363d',
          accent: '#58a6ff',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}