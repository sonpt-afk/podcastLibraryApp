import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import pool from './db';

// P1: Google only (SPEC §3). Email code via Resend arrives in P2.
export const auth = betterAuth({
  database: pool,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  // Test-only escape hatch so e2e can sign in without Google. Never enable in prod.
  emailAndPassword: { enabled: process.env.E2E_AUTH === '1' },
  plugins: [nextCookies()],
});
