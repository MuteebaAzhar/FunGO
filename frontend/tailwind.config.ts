import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary:   '#1B5FA8',
        'primary-dark': '#144a84',
        'primary-light': '#EBF4FF',
        secondary: '#3E9E3E',
        'secondary-light': '#EDF7ED',
        ink:       '#1A2433',
        ink2:      '#4A5568',
        ink3:      '#8A9BB0',
        edge:      '#DDE4EE',
        surface:   '#F7F9FC',
        surface2:  '#EFF3F8',
      },
      fontFamily: {
        sans: ['var(--font-plus)', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-jb)',   'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
