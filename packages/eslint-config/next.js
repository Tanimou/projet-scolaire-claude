/** ESLint config for Next.js apps */
module.exports = {
  extends: ['./index.js', 'next/core-web-vitals'],
  plugins: ['react', 'react-hooks'],
  rules: {
    'react/jsx-uses-react': 'off',
    'react/react-in-jsx-scope': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
