import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'node:path';

const env = loadEnv('test', process.cwd(), '');
// DB tests truncate tables: refuse to run unless a SEPARATE test database is configured.
if (!env.TEST_DATABASE_URL || env.TEST_DATABASE_URL === env.DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL in .env to a database different from DATABASE_URL');
}

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  // tsconfig has jsx: preserve (Next compiles it); vite (oxc) must transform JSX itself.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
    env: { ...env, DATABASE_URL: env.TEST_DATABASE_URL, TRANSCRIBE_PROVIDER: 'fake', GENERATE_PROVIDER: 'fake' },
    // DB tests share one test database, so run files serially.
    fileParallelism: false,
  },
});
