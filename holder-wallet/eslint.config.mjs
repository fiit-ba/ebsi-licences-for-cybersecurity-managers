import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'android/**',
      'ios/**',
      'node_modules/**',
      'coverage/**',
      '**/__snapshots__/**',
      '**/*.test.js',
      '**/*.jsbundle',
      'patches/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: [
      'src/infrastructure/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx,js,jsx}',
      'src/**/i18n/keys.ts',
      'src/app/navigation/wrappers/*.{ts,tsx}',
      'src/shared/hooks/useFeatureToogle.tsx',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
)
