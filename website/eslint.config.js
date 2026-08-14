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
        // Pre-existing debt kept visible as warnings so `eslint .` stays green.
        // These need case-by-case judgement (typing, intentional {@html},
        // navigation/reactivity idioms); fix opportunistically, don't add new ones.
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unsafe-function-type': 'warn',
            'svelte/no-at-html-tags': 'warn',
            'svelte/no-navigation-without-resolve': 'warn',
            'svelte/prefer-svelte-reactivity': 'warn',
            'svelte/prefer-writable-derived': 'warn',
        },
    },
];
