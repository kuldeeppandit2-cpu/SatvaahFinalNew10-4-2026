import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        saffron:       '#C8691A',
        verdigris:     '#2E7D72',
        'lt-verdigris': '#6BA89E',
        'deep-ink':    '#1C1C2E',
        ivory:         '#FAF7F0',
        'warm-sand':   '#F0E4CC',
        terracotta:    '#C0392B',
      },
    },
  },
  plugins: [],
};
export default config;
