# MailHealth — Intelligent Email List Health & Deliverability Platform

An MVP that goes beyond "valid / invalid" email verification. Upload a list,
understand its health, and know which contacts are safe to send to, which
should be removed or reviewed, and **exactly why**.

> Upload → Analyze → Verify → Score → Explain → Clean → Monitor

## Documentation

- [Full documentation](docs/DOCUMENTATION.md) — complete reference (features, API, config, usage).
- [Architecture](docs/ARCHITECTURE.md) — the clean-architecture layout of the server.
- [Deployment](docs/DEPLOY.md) — deploying to Railway, Vercel, or a VPS.
- [MailHealth AI Agent](docs/AGENT.md) — the optional AI operator that investigates list health and performs approved actions on top of the deterministic engine.
- [SMTP Worker](docs/SMTP-WORKER.md) — MailHealth's self-owned SMTP verification. The main app needs no outbound port 25; a dedicated worker does the mailbox probing. No third-party verification API required.

## Features (MVP scope)

- **User authentication** — register / login with JWT + secure cookie.
- **CSV / XLSX / TXT upload** — automatic email-column detection and de-duplication.
- **Multi-level verification** — syntax, DNS, MX, live SMTP mailbox probe,
  disposable detection, role-account detection, catch-all detection,
  temporary-failure / greylisting handling.
- **Risk classification** — every address is `Safe`, `Review`, `Remove`, or `Unknown`
  (never a bare valid/invalid).
- **Explainable results** — each address gets plain-language reasons and a
  business recommendation.
- **Deliverability health score** — 0–100 per address, plus an overall list
  health score with supporting metrics (deliverability, data quality, risk,
  domain health).
- **Automated list cleaning** — Keep / Review / Remove buckets and one-click
  campaign-ready export.
- **Campaign preflight** — "Can I safely send this campaign?" with a
  recommended send list.
- **Historical monitoring** — every verification is snapshotted so you can see
  how list health changes over time.
- **Credit management** — 1 credit per verified address.
- **REST API** — verify emails from your own apps using an `X-API-Key`.
- **Export** — download cleaned lists as CSV.

## How verification works

The pipeline is a hybrid, local-first engine (`server/verify/`):

1. **Syntax** — pragmatic RFC check + normalisation.
2. **Disposable / role** — matched against reference lists (bundled + optional
   external feed files in `data/feeds/`).
3. **DNS / MX** — resolved via Node's built-in DNS (implicit-MX fallback).
4. **SMTP probe** — a raw socket conversation up to `RCPT TO` (no mail is sent),
   which also probes a random address to detect **catch-all** domains.
5. **External provider fallback (hybrid, section 11)** — optional, only for
   addresses the local checks leave *inconclusive* (SMTP blocked, greylisted,
   unknown). Set `ZEROBOUNCE_API_KEY` or `KICKBOX_API_KEY` to activate one. When
   no provider is configured, unconfirmed addresses are reported honestly as
   **unknown** — the platform never fabricates a verdict.
6. **Independent dimensions, then an action** — the engine never collapses one
   characteristic into "health". It produces separate axes and only combines
   them at the end:

   - **Deliverability** — `deliverable | undeliverable | risky | unknown`
     (technical capability only; says nothing about the person).
   - **Confidence** — `high | medium | low | unknown` (strength of evidence).
     Lack of evidence is never turned into negative evidence.
   - **Risk signals** — descriptive characteristics (role-based, catch-all,
     disposable, no-MX, typo…). A risk signal never makes a deliverable address
     "invalid".
   - **Recommended action** — `KEEP | REVIEW | REMOVE | REVERIFY`, derived from
     the combination.

   Example: `sales@company.com` on a healthy domain is `deliverable`, `KEEP`,
   with a *note* that it is a shared/role mailbox — **not** a low health score.
   A role-based address is scored the same as an individual one; the only
   difference is the informational risk signal.

   Two further concepts from the design spec — **Engagement** (opens/clicks with
   *this* sender) and **Communication Eligibility** (unsubscribed/suppressed) —
   depend on sender-specific data the platform does not yet track, so it makes
   no claims about them (e.g. it never says "this person no longer uses this
   email").

## Whole-product capabilities (beyond the MVP)

- **Background job queue** (`queue.js`) — bulk verification runs as persistent,
  **resumable** jobs; an interrupted run picks up unverified contacts on restart.
- **Greylisting retry** — temp-failure/greylisted addresses get a `retry_after`
  timestamp and are automatically re-checked by the scheduler.
- **Scheduled re-verification** (`scheduler.js`) — per-list interval; each run
  snapshots list health so you can watch it change over time.
- **Health-drop alerts** — when a re-verification lowers list health, an alert is
  raised (with reasons) and a `health.dropped` webhook fires.
- **Webhooks** (`webhooks.js`) — per-user endpoints for `job.completed` /
  `health.dropped` / all events, with optional HMAC-SHA256 signing. Standardized
  payloads suit Zapier / Make / CRMs (section 10).
- **Benchmark harness** (`npm run benchmark`) — runs a labelled dataset through
  the local engine and the provider, reporting accuracy, agreement, per-address
  time, and estimated provider cost (section 14).
- **Exports** — CSV and **XLSX**, filterable (all / safe / review / remove /
  unknown / campaign).
- **Bulk contact actions** — e.g. delete all `remove`-classified contacts.
- **Dashboard charts** — health-over-time line chart, classification stacked bar.

> **Note on SMTP:** many networks (and most cloud providers) block outbound
> port 25. When the probe cannot connect, addresses are marked `Unknown`
> (retry candidates) rather than wrongly rejected. Set `SMTP_ENABLED=false`
> in `.env` to skip live probing entirely — results then rely on syntax, DNS,
> MX, disposable and role signals.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000 and create an account through the UI.

Configuration lives in `.env` (see `.env.example`).

Optional — benchmark verification quality against a labelled dataset you supply:

```bash
npm run benchmark path/to/your-dataset.json
```

## API quick start

```bash
curl -X POST http://localhost:3000/api/verify/single \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"john@company.com"}'
```

## Project structure

```
server/
  index.js            Express app + static hosting; boots queue/scheduler/feeds
  config.js           env config + .env loader
  db.js               SQLite schema + migrations (better-sqlite3)
  auth.js             hashing, JWT, credit charging, middleware
  parse.js            CSV/XLSX/TXT parsing + column detection + dedup
  queue.js            persistent, resumable background verification jobs
  scheduler.js        scheduled re-verification + greylist retries
  webhooks.js         outbound webhook delivery (HMAC-signed)
  benchmark.js        verification-quality benchmark harness (bring your own dataset)
  verify/
    engine.js         orchestration, scoring, classification, explanations
    syntax.js         syntax validation
    dns.js            DNS/MX resolution (cached)
    smtp.js           SMTP mailbox + catch-all probe
    providers.js      optional external providers (ZeroBounce/Kickbox)
    health.js         list-level health scoring
    data.js           disposable/role/free/typo data (+ feed loader)
  routes/
    auth.js  verify.js  lists.js  campaign.js  integrations.js
public/
  index.html styles.css app.js api.js ui.js
data/feeds/*.txt         optional disposable.txt / roles.txt feeds
```

## Not in this MVP (by design)

Mobile app, large integration marketplace, AI chatbot, enterprise permissions,
dozens of CRM integrations, advanced marketing automation, unlimited
monitoring, and proprietary verification infrastructure before validation.
