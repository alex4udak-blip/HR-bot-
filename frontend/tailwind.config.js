/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          50: 'var(--tw-dark-50)',
          100: 'var(--tw-dark-100)',
          200: 'var(--tw-dark-200)',
          300: 'var(--tw-dark-300)',
          400: 'var(--tw-dark-400)',
          500: 'var(--tw-dark-500)',
          600: 'var(--tw-dark-600)',
          700: 'var(--tw-dark-700)',
          800: 'var(--tw-dark-800)',
          900: 'var(--tw-dark-900)',
          950: 'var(--tw-dark-950)',
        },
        accent: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#b9e6fe',
          300: '#7cd4fd',
          400: '#36bffa',
          500: '#0ca5eb',
          600: '#0084c9',
          700: '#0169a3',
          800: '#065986',
          900: '#0b4a6f',
          950: '#072f4a',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'float': 'float 6s ease-in-out infinite',
        'float-delayed': 'float 8s ease-in-out infinite',
        'float-slow': 'float 10s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 4s ease-in-out infinite',
        'gradient-shift': 'gradientShift 15s ease infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'orbit': 'orbit 20s linear infinite',
        'orbit-reverse': 'orbit 25s linear infinite reverse',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) translateX(0)' },
          '25%': { transform: 'translateY(-20px) translateX(10px)' },
          '50%': { transform: 'translateY(-10px) translateX(-10px)' },
          '75%': { transform: 'translateY(-30px) translateX(5px)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateX(150px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(150px) rotate(-360deg)' },
        },
      },
    },
  },
  plugins: [],
}
