# Google sign-in for Ava

A single **Continue with Google** action creates or opens the account. Auth.js v5 issues a JWT session. Ava uses the stable Google account ID from that session to find an independent Simulation workspace in the existing Upstash Redis database. First access seeds the same demo escrows in that workspace. Guest Simulation stays in the current browser’s local storage, and its data is not imported when signing in. The wallet-free Devnet judge flow keeps its own sponsor credentials and authorization.

## Google Cloud Console

1. In Google Cloud Console, select or create the Ava project. Open **Google Auth Platform → Branding**. If prompted, select **Get started**. Enter an app name such as Ava, a user support email, and a developer contact email. Review the terms and create the consent configuration.
2. In **Audience**, choose **External**. While the app is in **Testing**, select **Test users → Add users**, enter the Google addresses you plan to use, and save. For general Google sign-in, select **Publish app** under publishing status when ready and complete any verification Google requests. Judges can use guest Simulation regardless of publishing status.
3. In **Data Access**, keep the sign-in scopes to `openid`, `email`, and `profile`. Ava uses the normal Google OpenID Connect profile.
4. Open **Clients → Create client → Web application**, name it Ava, and add these exact **Authorized redirect URIs**. Create the client and copy its client ID and secret. For this server-side redirect flow, Authorized JavaScript origins can be left blank.

```text
http://localhost:3000/api/auth/callback/google
https://ava-puce-xi.vercel.app/api/auth/callback/google
```

[Google consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent) · [Google web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) · [Auth.js Google provider](https://authjs.dev/getting-started/providers/google)

## Environment

Generate each environment’s `AUTH_SECRET` with `openssl rand -base64 32`. Add these to the ignored `.env.local` for local use and to **Vercel → Project Settings → Environment Variables → Production** for the live site. Keep secrets server-side and omit the `NEXT_PUBLIC_` prefix.

| Variable | Setup |
| --- | --- |
| `AUTH_SECRET` | Generated secret for JWT sessions. Keep it stable across deployments of the same environment. |
| `AUTH_GOOGLE_ID` | Web application's OAuth client ID. |
| `AUTH_GOOGLE_SECRET` | Web application's OAuth client secret. |
| `AUTH_URL` | `http://localhost:3000` locally and `https://ava-puce-xi.vercel.app` in Production. |
| `AUTH_TRUST_HOST` | Auth.js detects Vercel automatically. Set `true` explicitly if needed behind a trusted reverse proxy. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Reuse Ava’s existing Upstash REST configuration. Use a writable token and preferably a separate Upstash database for local tests. |

Redeploy Production after saving the variables. Without Google or Upstash configuration, the login page leaves the guest path available.

[Auth.js deployment variables](https://authjs.dev/getting-started/deployment) · [Vercel environment variables](https://vercel.com/docs/environment-variables)

## Smoke test

1. Install dependencies with `npm ci`, then run `npm test` and `npm run dev`. Open `http://localhost:3000/login`.
2. Choose **Try the demo without signing in**. Draft and confirm a simulated escrow, then open Activity and Settings. Reload and verify guest data stays in that browser. Check that `/devnet` still opens without Google sign-in.
3. Sign in with Google account A. Verify the account name/avatar and seeded escrows. Create an escrow, save its detail URL, change the spending limit, pause the workspace, then sign out and back in. Verify the changes survived.
4. In a private window sign in with account B. Open A’s saved Simulation payment URL and verify Ava displays **Escrow unavailable**. B should see its own seeded workspace and settings. A guest request to `/api/workspace` returns HTTP 401.
