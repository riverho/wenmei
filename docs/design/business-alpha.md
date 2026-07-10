# Design — Alpha Business Layer (Phase H9)

**Status:** Design, 11 Jul 2026.
**Plan ref:** [`docs/revamp-phase-improvement-plan-04Jul2026.md`](../revamp-phase-improvement-plan-04Jul2026.md) §5 + Phase H.

Developer-first, local-first, zero inference cost to us. Nothing here
publishes anything; pricing numbers are working hypotheses for River's
sign-off.

## 1. Who pays for what

**Alpha customer: developers.** BYO agent, BYO API keys. They pay for the
manager, not the model: supervision across N terminals, reviewable/reversible
changesets, ledger memory per project, sentinel alerts ("blocked and
burning"), heartbeat runs, reports. Sentinel mode means Wenmei never carries
inference cost — the monetization sketch's core constraint holds.

**Later customer: knowledge workers** via the **token add-on plan** — Wenmei-
managed keys metered through us; that is when Full-narration (Level 1
Translator) returns as a consumer feature. Out of alpha scope; designed here
only so the license schema doesn't need breaking later.

## 2. Tiers and gating (alpha)

| Capability | Free | Pro |
| --- | --- | --- |
| Editor, one vault, manual terminal sessions | ✓ | ✓ |
| Observer facts: alerts, changesets, timeline (one project) | ✓ | ✓ |
| Managed projects (`.agents-playbook` + Narrate) | 1 project | unlimited |
| Multiple vaults / windows / terminal tabs | 1 vault, 2 tabs | unlimited |
| Review surface (approve/reject/restore) | ✓ (trust is the funnel, never paywalled) | ✓ |
| Heartbeat run cards, night shift | — | ✓ |
| Approval relay (alerts with hands) | — | ✓ |
| Reports/briefings ("write my standup") | — | ✓ |
| Audit export | — | ✓ |

Rule: **safety features are never paywalled** (review/restore, secret
redaction, sandbox). Paywall the *leverage* features: scale, autonomy,
reporting.

## 3. Trial mechanics

- **14-day full-Pro trial, no account, no card.** Local-first product,
  local-first trial: first-run stamps `trial_started_at` in the OS keychain
  (fallback: state.json + a salted marker file — accept that determined
  users can reset it; the honest deterrent is enough at $79).
- Countdown surfaces in Settings › License and as a `system.trial` feed
  notice at T-3 days — never a modal nag mid-work.
- Expiry degrades to Free (limits apply); nothing is deleted, no feature
  destroys data on downgrade by design (extra vaults become read-only
  switchable, not detached).

## 4. Payments and license keys

- **Provider: Paddle or Lemon Squeezy** (merchant-of-record — they handle
  global VAT/sales tax, which a solo developer product must not). Decision
  criterion is fees + payout country support; both issue license keys via
  API. **Recommendation: Lemon Squeezy** for simpler API and native license
  key issuing; Paddle as fallback if payout terms disagree. River decides at
  purchase-page build time.
- **Key format:** `WENMEI-<base32 payload>-<sig>` — payload carries tier,
  issue date, seat count; signature is Ed25519 against our offline public
  key embedded in the app. **Verification is fully offline** (same trust
  model as the updater pubkey). Activation pings are *not* required; the
  provider's key API is used only for issuing and (optional, best-effort)
  revocation checks when online.
- One-time **$79 Pro** (working hypothesis from the monetization sketch),
  includes 12 months of updates; renewal ~$39/yr for continued updates
  (perpetual-fallback license — the version you have keeps working forever).
- Seat = machine count soft-checked (key payload allows 3 activations,
  honor-system beyond that).

## 5. Token add-on plan (design only, post-alpha)

- Consumer tier: Wenmei-managed inference. Monthly plan bundles N tokens for
  Narrate Full-mode + analyst calls; metering already exists conceptually as
  the per-project `narrate_budget` — the add-on plan is the same meter with
  our key behind it instead of the user's.
- Requires: proxy keys, usage accounting per project, budget alerts
  (`resource.budget` class — already in the taxonomy), and hard stop at plan
  ceiling. No rollover in v1.
- Pricing anchored to cost + margin per narration event, not per seat —
  publish the meter, never surprise-bill (the cost-blackhole lesson).

## 6. Alpha closure checklist

- [ ] River signs pricing + provider choice.
- [ ] Purchase page on the landing site (static; provider-hosted checkout).
- [ ] Key verification (Ed25519) in `state.rs` license path; Settings key
      entry already ships.
- [ ] Trial stamp + degrade-to-Free gating behind one `licenseTier` check
      per gated surface.
- [ ] Refund policy page (14 days, no questions — matches trial).
- [ ] EULA + privacy note: "your files and terminal output never leave your
      machine except metered analyst calls you configure."
