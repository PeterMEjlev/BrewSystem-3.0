import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// `npm run build` runs this first and refuses to build on any error, and the
// rig's deploy builds before it restarts anything — so an error here is what
// keeps a broken bundle off the kiosk. That only works if errors mean "this will
// break at runtime": an undefined name (a prop used but never destructured
// blanked the whole brewing screen once), a hook called conditionally, a
// reassigned const. Style and React-purity advice stays visible as warnings,
// because a gate that is always red gets bypassed.
const ADVISORY = {
  'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
  'no-empty': 'warn',
  'react-hooks/set-state-in-effect': 'warn',
  'react-hooks/refs': 'warn',
  'react-hooks/purity': 'warn',
  'react-refresh/only-export-components': 'warn',
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: ADVISORY,
  },
  {
    // The Electron side is CommonJS running under Node, not the browser.
    files: ['electron/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
])
