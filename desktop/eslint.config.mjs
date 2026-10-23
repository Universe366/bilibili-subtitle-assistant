import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'build/**', 'resources/**', 'spike/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      // 存量代码里还有 70 多处 any、几十个未使用变量/赋值，先作为告警而不是阻塞构建；
      // 新代码不要新增这类告警。
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // 该规则会把 try/catch 里的初始化误判成“无用赋值”，存量代码里误报太多。
      'no-useless-assignment': 'off',
      // library.ts 用 \x1f 作为标签分隔符，是有意为之。
      'no-control-regex': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 日志统一由 logger 钩子落盘，允许直接使用 console。
      'no-console': 'off',
      // TypeScript 已经负责未定义检查，避免 ESLint 对类型环境误报。
      'no-undef': 'off'
    }
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
