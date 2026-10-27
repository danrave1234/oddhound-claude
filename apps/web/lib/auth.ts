import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { getPool } from '@core/db/pool.ts';

const devLogin = process.env.ODDHOUND_DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';
const github = process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
  ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, scope: ['user:email'] } }
  : {};

const ts = { createdAt: 'created_at', updatedAt: 'updated_at' };

export const auth = betterAuth({
  database: getPool(),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  user: {
    fields: { emailVerified: 'email_verified', ...ts },
    additionalFields: {
      isAdmin: { type: 'boolean', fieldName: 'is_admin', defaultValue: false, input: false },
      allowlisted: { type: 'boolean', fieldName: 'allowlisted', defaultValue: false, input: false },
      revoked: { type: 'boolean', fieldName: 'revoked', defaultValue: false, input: false },
    },
  },
  session: { fields: { expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', userId: 'user_id', ...ts } },
  account: {
    fields: {
      accountId: 'account_id', providerId: 'provider_id', userId: 'user_id', accessToken: 'access_token', refreshToken: 'refresh_token',
      idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', ...ts,
    },
  },
  verification: { fields: { expiresAt: 'expires_at', ...ts } },
  socialProviders: github,
  // Local development sign-in only. Never enabled when NODE_ENV=production.
  emailAndPassword: { enabled: devLogin, minPasswordLength: 10 },
  plugins: [nextCookies()],
});

export const authConfig = { devLogin, github: Boolean(github.github) };
