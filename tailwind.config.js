module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#09090B',
        card: '#18181B',
        accent: '#6366F1',
      },
    },
  },
};
