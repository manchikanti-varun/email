# MailHealth — Intelligent Email List Health & Deliverability Platform
# MailHealth — Intelligent Email List Health & Deliverability Platform

Goes beyond "valid / invalid" email verification. Upload a list, understand its
health, know which contacts are safe to send to, which to remove or review, and
**exactly why** — with an optional AI diagnosis on top of a deterministic engine
that remains the sole source of truth.

> Upload → Analyze → Verify → Score → Explain → Diagnose → Clean → Monitor

## Documentation

- [Full documentation](docs/DOCUMENTATION.md) — complete reference: features, architecture, API, config, usage, deployment, SMTP worker, AI layers, and more.

## Features

- **Authentication** — register / login with JWT (in a secure cookie) or an
  `X-API-Key`. Logout revokes the token server-side.
- **CSV / XLSX / XLS / TXT upload** — automatic email-column detection and
  de-duplication.
- **Multi-level verification** — syntax, DNS, MX, live SMTP mailbox probe,
  disposable / role-account / catch-all detection, temporary-failure /
  greylisting handling.
- **Explainable classification** — every address is `Safe`, `Review`, `Remove`,
  or `Unknown` (never a bare valid/invalid), with plain-language reasons and a
  recommended action. Catch-all is `Accepted` / `ACCEPT_ALL` / KEEP
  (campaign-eligible) with a descriptive signal — not "risky".
- **Health score** — 0–100 per address, plus an overall list health score with
  supporting metrics (deliverability, data quality, risk, domain health).
- **AI List Health diagnosis** — one list-level AI diagnosis (summary, key
  issues, recommended actions) on an explainable deterministic score; falls back
  to a deterministic diagnosis when no LLM is configured.
- **AI agent** — an optional, list-focused operator that investigates health and
  performs approved (confirmation-gated) actions. Never fabricates or overrides
  a verdict.
- **Automated cleaning** — Keep / Review / Remove buckets and one-click
  campaign-ready export (CSV / XLSX).
- **Campaign preflight** — "Can I safely send this campaign?" with a recommended
  send list and a verdict.
- **Historical monitoring** — scheduled re-verification snapshots list health
  over time and raises alerts when it drops.
- **Credit management** — 1 credit per verified address (new accounts start with
  free credits).
- **REST API + webhooks** — verify from your own apps; outbound webhooks
  (`job.completed`, `health.dropped`) with HMAC signing and secrets encrypted at
  rest.

## How verification works

The pipeline is a hybrid, local-first engine (`server/src/domain/verification/`,
with adapters in `server/src/infrastructure/verification/`):

1. **Syntax** — pragmatic RFC check + normalisation.
2. **Disposable / role** — matched against reference lists (bundled + optional
   external feed files in `data/feeds/`).
3. **DNS / MX** — resolved via Node's built-in DNS (implicit-MX fallback).
4. **SMTP probe** — a raw socket conversation `EHLO → MAIL FROM → RCPT TO →
   QUIT` (**no message body / `DATA` is ever sent**), which also probes a random
   address to detect **catch-all** domains. Routed by an `SmtpRouter` — locally
   when this host has outbound port 25, otherwise via the MailHealth SMTP worker.
5. **External provider fallback (optional)** — only for addresses the local
   checks leave *inconclusive* (SMTP blocked, greylisted, unknown). Set
   `ZEROBOUNCE_API_KEY` or `KICKBOX_API_KEY` to activate one. When no provider
   is configured, unconfirmed addresses are reported honestly as **unknown** —
   the platform never fabricates a verdict.
6. **Independent dimensions, then an action** — the engine never collapses one
   characteristic into "health". It produces separate axes and only combines
   them at the end:

   - **Deliverability** — `deliverable | accepted | undeliverable | risky |
     unknown` (technical capability only; says nothing about the person).
     `accepted` is the catch-all case — positive infrastructure evidence where
     the exact mailbox cannot be independently confirmed.
   - **Mailbox status** — `DELIVERABLE | UNDELIVERABLE | ACCEPT_ALL | UNKNOWN`
     (what can actually be proven about the mailbox).
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

- **Background job queue** (`src/infrastructure/jobs/verification-queue.js`) —
  bulk verification runs as persistent, **resumable** jobs; an interrupted run
  picks up unverified contacts on restart.
- **Greylisting retry** — temp-failure/greylisted addresses get a `retry_after`
  timestamp and are automatically re-checked by the scheduler.
- **Scheduled re-verification** (`src/infrastructure/jobs/scheduler.js`) —
  per-list interval; each run snapshots list health so you can watch it change
  over time.
- **Health-drop alerts** — when a re-verification lowers list health, an alert is
  raised (with reasons) and a `health.dropped` webhook fires.
- **Webhooks** (`src/infrastructure/webhooks/http-webhook-sender.js`) — per-user
  endpoints for `job.completed` / `health.dropped` / all events, with optional
  HMAC-SHA256 signing. Standardized payloads suit Zapier / Make / CRMs.
- **AI intelligence layer** — deterministic analysis (campaign risk, health
  analysis/prediction, anomaly/incident detection, domain intelligence, smart
  cleaning, credit optimisation, business insights, investigation) plus an
  optional ML confidence calibration that estimates verdict reliability without
  ever changing the verdict.
- **Benchmark harness** (`npm run benchmark`) — runs a labelled dataset through
  the local engine and the provider, reporting accuracy, agreement, per-address
  time, and estimated provider cost.
- **Exports** — CSV and **XLSX**, filterable (all / safe / review / remove /
  unknown / campaign).
- **Bulk contact actions** — e.g. delete all `remove`-classified contacts.
- **Dashboard charts** — health-over-time line chart, classification stacked bar.

> **Note on SMTP:** many networks (and most cloud providers) block outbound
> port 25. When the probe cannot connect, addresses are marked `Unknown`
> (retry candidates) rather than wrongly rejected. Set `SMTP_ENABLED=false`
> in `.env` to skip live probing entirely — results then rely on syntax, DNS,
> MX, disposable and role signals.
>
> `SMTP_MODE` controls routing: `auto` (default) tries local port 25 and falls
> back to the MailHealth SMTP worker, `local` uses only the local probe,
> `remote` always uses the worker, and `disabled` performs no probing. Point
> `SMTP_WORKER_URL` + `SMTP_WORKER_SECRET` at a deployed worker — see the
> [full documentation](docs/DOCUMENTATION.md).

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000 and create an account through the UI.

**Requirements:** Node.js 24.x. No external services are required — the database
is embedded SQLite and the AI is optional. Configuration lives in `.env` (see
`.env.example`).

Local development needs no outbound port 25: use `SMTP_MODE=disabled` (or
`local` if your host has port 25), and leave the AI unconfigured to run the
diagnosis/intelligence deterministically.

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
  index.js            thin entrypoint -> src/main.js
  config.js           env config + .env loader + prod safety checks
  benchmark.js        verification-quality harness (uses the real engine)
  src/
    domain/
      entities/         user.js, contact.js
      verification/     engine.js, syntax.js, smtp-classify.js, health.js,
                        reference-data.js, __tests__/
      ports/            index.js  (repository + gateway contracts)
    application/        *-use-cases.js (auth, verify, list, campaign,
                        integration, agent, ai, list-health) + errors.js
    infrastructure/
      persistence/sqlite/   connection.js, schema.js, one repository per aggregate
      verification/         node-dns-resolver, socket-smtp-probe,
                            remote-smtp-probe, smtp-router, smtp-policy,
                            providers, feed-loader
      security/             bcrypt-password-hasher, jwt-token-service,
                            api-key-service, secret-crypto
      webhooks/             http-webhook-sender
      jobs/                 verification-queue, scheduler
      parsing/              file-parser
    interfaces/http/
      app.js            buildApp(container)
      middleware.js     auth, logging, rate limits, errors, cookies
      routes/           auth, verify, list, campaign, integration, agent, ai
    container.js        composition root
    main.js             start()
  agent/              AI operator + intelligence layer + ML calibration
frontend/             React + TypeScript app (Vite); feature-based src/;
                      builds into public/
smtp-worker/          standalone port-25 SMTP worker (own package.json, + ssrf.js)
public/               generated build output (served by the Node server)
data/feeds/*.txt      optional disposable.txt / roles.txt feeds
```

## Out of scope (by design)

Sending email, SMTP relay, campaign/marketing automation, CRM, billing,
enterprise RBAC, a general-purpose chatbot (the AI operator is deliberately
list-focused and never invents verification results), and any port-25
bypass/tunnel/proxy. The SMTP path is always: main app → HTTPS → dedicated SMTP
worker → TCP 25 → recipient MX → evidence → main-app classification.

Also not tracked by design: sender-specific **engagement** (opens/clicks) and
**communication eligibility** (unsubscribes/suppression) — these depend on
data the platform does not collect, so it makes no claims about them.
