/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#1c1c1c',
          secondary: '#242424',
          panel: '#2a2a2a',
          hover: '#333333',
        },
        accent: {
          DEFAULT: '#00A6FF',
          dim: '#0080cc',
        },
        border: '#3a3a3a',
        text: {
          primary: '#e8e8e8',
          muted: '#888888',
          dim: '#555555',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
