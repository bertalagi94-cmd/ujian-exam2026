/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/styles/**/*.css',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#0c2d38',
        },
        accent: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        warn: {
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
        },
        danger: {
          50:  '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        surface: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // ── Palet login premium (additive — tidak mengubah yang lama) ──────
        ink: {
          50:  '#e8eaf6',
          100: '#c5cae9',
          200: '#9fa8da',
          300: '#7986cb',
          400: '#5c6bc0',
          500: '#3f51b5',
          600: '#1a237e',
          700: '#0d1340',
          800: '#090e30',
          900: '#050921',
          950: '#020510',
        },
        glow: {
          purple: '#a855f7',
          pink:   '#ec4899',
          blue:   '#3b82f6',
          orange: '#f97316',
          amber:  '#fbbf24',
          rose:   '#f43f5e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card:        '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
        'card-md':   '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.08)',
        'card-lg':   '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08)',
        'glow-purple':'0 0 40px rgba(168,85,247,0.55), 0 0 80px rgba(168,85,247,0.25)',
        'glow-pink':  '0 0 40px rgba(236,72,153,0.55), 0 0 80px rgba(236,72,153,0.25)',
        'glow-blue':  '0 0 40px rgba(59,130,246,0.55), 0 0 80px rgba(59,130,246,0.25)',
        'glow-orange':'0 0 40px rgba(249,115,22,0.55), 0 0 80px rgba(249,115,22,0.25)',
        glass:        '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
      },
      backdropBlur: {
        '3xl': '48px',
      },
      borderRadius: {
        xl:   '0.75rem',
        '2xl':'1rem',
        '3xl':'1.5rem',
      },
      animation: {
        'fade-in':       'fadeIn 0.3s ease-out',
        'slide-up':      'slideUp 0.4s ease-out',
        'pulse-slow':    'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float':         'float 2.6s ease-in-out infinite',
        // Login premium
        'aurora-1':      'aurora1 18s ease-in-out infinite',
        'aurora-2':      'aurora2 24s ease-in-out infinite',
        'aurora-3':      'aurora3 30s ease-in-out infinite',
        'batik-drift':   'batikDrift 70s ease-in-out infinite',
        'shimmer':       'shimmer 3s ease infinite',
        'pulse-soft':    'pulseSoft 2.5s ease-in-out infinite',
        'particle-float':'particleFloat 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: 0 },                 to: { opacity: 1 } },
        slideUp:  { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-18px)' },
        },
        // Aurora blobs
        aurora1: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%':     { transform: 'translate(80px,-60px) scale(1.15)' },
          '66%':     { transform: 'translate(-60px,80px) scale(0.9)' },
        },
        aurora2: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%':     { transform: 'translate(-100px,60px) scale(1.2)' },
          '66%':     { transform: 'translate(80px,-40px) scale(0.85)' },
        },
        aurora3: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%':     { transform: 'translate(60px,100px) scale(1.1)' },
        },
        batikDrift: {
          '0%,100%': { transform: 'translate(0,0) rotate(0deg)' },
          '25%':     { transform: 'translate(-1.5%,-1%) rotate(0.3deg)' },
          '75%':     { transform: 'translate(1%,1.5%) rotate(-0.3deg)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-300% 50%' },
          '100%': { backgroundPosition: '300% 50%' },
        },
        pulseSoft: {
          '0%,100%': { opacity: 1 },
          '50%':     { opacity: 0.55 },
        },
        particleFloat: {
          '0%,100%': { transform: 'translateY(0)', opacity: 0.6 },
          '50%':     { transform: 'translateY(-20px)', opacity: 1 },
        },
      },
      backgroundImage: {
        'radial-glow-purple': 'radial-gradient(circle, rgba(168,85,247,0.6) 0%, transparent 70%)',
        'radial-glow-pink':   'radial-gradient(circle, rgba(236,72,153,0.5) 0%, transparent 70%)',
        'radial-glow-blue':   'radial-gradient(circle, rgba(59,130,246,0.5) 0%, transparent 70%)',
        'radial-glow-orange': 'radial-gradient(circle, rgba(249,115,22,0.5) 0%, transparent 70%)',
      },
    },
  },
  plugins: [],
}
