/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        nina: {
          black: '#0a0a0a',
          ink: '#141414',
          panel: '#1a1a1a',
          line: '#262626',
          silver: '#c8c8c8',
          chrome: '#e8e8e8',
          mute: '#8a8a8a',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'serif'],
      },
      backgroundImage: {
        'silver-gradient':
          'linear-gradient(135deg, #ffffff 0%, #c8c8c8 35%, #8a8a8a 50%, #c8c8c8 65%, #ffffff 100%)',
        'silver-shine':
          'linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%)',
      },
      boxShadow: {
        chrome: '0 0 30px rgba(232,232,232,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
        glow: '0 0 60px rgba(232,232,232,0.15)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        fadeUp: {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 3s linear infinite',
        float: 'float 4s ease-in-out infinite',
        fadeUp: 'fadeUp 0.5s ease-out both',
      },
    },
  },
  plugins: [],
}
