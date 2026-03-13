/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg':    '#1c1c1e',
        'panel':     '#242428',
        'panel-dark':'#1a1a1d',
        'parchment': '#e8d5a3',
        'text-dim':  '#8a7a5a',
        'brass':     '#c8a84b',
        'amber':     '#d4954a',
        'fire':      '#cc4a2a',
        'allied':    '#4a7c59',
        'axis':      '#6b7355',
        'map-bg':    '#14160e',
        'border-military': '#3a3a30',
      },
      fontFamily: {
        mono: ['"Courier New"', 'Courier', 'monospace'],
      },
    },
  },
  plugins: [],
}
