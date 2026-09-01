import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import svelteConfig from './svelte.config.js';

/** Flat config (ESLint v9). Mirrors the previous .eslintrc.cjs rulesets:
 *  eslint:recommended + @typescript-eslint/recommended + svelte/recommended + prettier. */
export default [
    {
        ignores: [
            '.DS_Store',
            'build/',
            '.svelte-kit/',
            'package/',
            'node_modules/',
            'static/',
            '*.config.js',
            '*.config.ts',
        ],
    },
    js.configs.recommended,
    ...tsPlugin.configs['flat/recommended'],
    ...svelte.configs['flat/recommended'],
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    {
        files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
        languageOptions: {
            parserOptions: {
                parser: tsParser,
                extraFileExtensions: ['.svelte'],
                svelteConfig,
            },
        },
    },
    prettier,
    ...svelte.configs['flat/prettier'],
    {
        // Enforced, not advisory: `eslint .` must stay at zero. Where one of these rules is
        // genuinely the wrong call for a specific line, suppress it inline with
        // `// eslint-disable-next-line <rule>` plus a comment saying why — don't lower the
        // severity here. Existing exceptions: the sanitized {@html} in WaypointPopup, the
        // non-reactive Maps in toolbar/tools/reduce/utils.svelte.ts, ListItem's dynamic index
        // signature in file-list.ts, and Setting.update's callback type in logic/settings.ts.
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unsafe-function-type': 'error',
            'svelte/no-at-html-tags': 'error',
            // Link checking is off: every internal href is built by getURLForLanguage()
            // (lib/utils.ts), which already applies `base`. The rule cannot see through the
            // helper, so it only reports false positives there — and wrapping a call in
            // resolve() would prefix `base` twice, breaking any BASE_PATH deployment.
            // goto/pushState/replaceState stay enforced, which is where the rule earns its keep.
            'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }],
            'svelte/prefer-svelte-reactivity': 'error',
            'svelte/prefer-writable-derived': 'error',
        },
    },
];
