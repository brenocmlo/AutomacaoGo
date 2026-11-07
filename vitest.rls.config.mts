import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Testes de RLS: rodam contra o projeto Supabase do .env.local (rede), em série.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/rls/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
