# Deployment — Backend on Railway, Frontend on Vercel

The app is split for deployment:

- **Backend** (Node/Express + SQLite) → **Railway**
- **Frontend** (static `public/`) → **Vercel**

They talk over HTTPS. The frontend calls the backend by its public Railway URL,
authenticated with a Bearer token (works even if third-party cookies are blocked).

> **Note on verification accuracy:** Railway blocks outbound port 25, so live
> SMTP mailbox probing will not run there. Deliverable mailboxes will show as
> `unknown / reverify` (the honest fallback). All other checks — syntax, domain,
> DNS, MX, disposable, role, reserved, catch-all where detectable — work fully.
> For real mailbox confirmation you'd later run the backend on a host with port
> 25 open, or plug in a provider key.

---

## Part 1 — Deploy the backend to Railway

1. Push this repo to GitHub.
2. Go to **railway.app** → **New Project** → **Deploy from GitHub repo** → pick this repo.
3. Railway auto-detects Node (via `railway.json` / Nixpacks) and runs `node server/index.js`.
4. **Add a persistent volume** (so the SQLite database survives redeploys):
   - Project → your service → **Variables**/**Settings** → **Volumes** → **New Volume**
   - Mount path: `/data`
5. **Set environment variables** (service → **Variables**):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | a long random string (see below) |
   | `DATA_DIR` | `/data` |
   | `TRUST_PROXY` | `1` |
   | `COOKIE_SECURE` | `true` |
   | `COOKIE_SAMESITE` | `none` |
   | `CORS_ORIGINS` | your Vercel URL, e.g. `https://your-app.vercel.app` |
   | `SMTP_ENABLED` | `false` |

   Generate `JWT_SECRET` locally:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   > Do NOT set `PORT` — Railway provides it automatically and the app reads it.

6. Deploy. Under **Settings → Networking**, click **Generate Domain**. You'll get
   something like `https://your-app.up.railway.app`. **Copy this URL.**
7. Verify: open `https://your-app.up.railway.app/api/health` → should return JSON.

> You can update `CORS_ORIGINS` after step 2 of Part 2 once you know the exact
> Vercel domain. It accepts a comma-separated list if you have several.

---

## Part 2 — Deploy the frontend to Vercel

1. Go to **vercel.com** → **Add New… → Project** → import the same GitHub repo.
2. **Environment Variables** → add:

   | Variable | Value |
   |---|---|
   | `BACKEND_URL` | your Railway URL from Part 1 (e.g. `https://your-app.up.railway.app`) |

3. Vercel reads `vercel.json`:
   - Build command: `node scripts/build-frontend.mjs` (writes `public/config.js` from `BACKEND_URL`)
   - Output directory: `public`
4. Deploy. You'll get a URL like `https://your-app.vercel.app`.
5. **Go back to Railway** and make sure `CORS_ORIGINS` equals that exact Vercel
   URL, then redeploy the backend (or just save — Railway restarts).

---

## Part 3 — Verify the split works

1. Open your Vercel URL in the browser.
2. Register an account. If it succeeds and you land on the dashboard, the
   frontend↔backend connection + CORS + auth are all working.
3. Open DevTools → Network → confirm requests go to your **Railway** URL and
   return `200`, not CORS errors.

### If you see CORS errors
- `CORS_ORIGINS` on Railway must match the Vercel origin **exactly** (scheme +
  host, no trailing slash).
- Redeploy the backend after changing it.

### If login "works" but you get logged out on refresh
- That's third-party cookies being blocked (common in Safari). The app already
  falls back to a Bearer token in `localStorage`, so this normally still works.
  Ensure `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` are set on Railway.

---

## Local development (unchanged)

Locally the frontend and backend are the **same origin**, so `config.js` stays
empty and everything just works:

```bash
npm install
npm start
# open http://localhost:3000
```

## Environment variable reference

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | Railway | Session/token signing (required in prod) |
| `DATA_DIR` | Railway | SQLite location; point at the mounted volume `/data` |
| `CORS_ORIGINS` | Railway | Allowed browser origin(s) = your Vercel URL |
| `COOKIE_SECURE` | Railway | `true` in prod |
| `COOKIE_SAMESITE` | Railway | `none` for cross-domain |
| `TRUST_PROXY` | Railway | `1` (behind Railway's proxy) |
| `SMTP_ENABLED` | Railway | `false` (port 25 blocked on Railway) |
| `BACKEND_URL` | Vercel | The Railway backend URL the frontend calls |
