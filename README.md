# Sudbury Tee-Time Bot

Playwright automation that logs into the Sudbury Intelligent Golf member portal
(`https://sudbury.intelligentgolf.co.uk/memberbooking/`) and books a tee time
from a prioritized list. Runs headed, persists the login session, and retries
until it secures a slot.

## Setup

```bash
npm install            # installs Playwright + Chromium
cp .env.example .env   # then fill in IG_USERNAME / IG_PASSWORD
```

Edit `config.json`:

| Field | Meaning |
|---|---|
| `date` | Booking date `YYYY-MM-DD` |
| `preferred_times` | Ordered list of preferred tee times `HH:MM` |
| `players` | Total players in the booking (informational) |
| `partners` | Member names (e.g. `"SMITH, JOHN"`) to add as additional players |
| `max_retries` | Retry attempts when no match / booking fails |
| `retry_interval_seconds` | Seconds between retries (jittered ±20%) |
| `preload.enabled` | Wait until the daily release window before booking |
| `preload.release_time_local` | Local time bookings open, `HH:MM` |
| `preload.lead_seconds` | Start refreshing this many seconds before release |
| `preload.refresh_interval_ms` | Refresh cadence during pre-load window |

## Run

```bash
npm run book              # real booking
npm run dry-run           # parses tee sheet and opens booking modal but does NOT click Confirm
```

A persistent Chromium profile is stored in `./user-data/` so login is reused
across runs. Logs go to `logs/run-<ts>.log`. Screenshots go to `screenshots/`
(success, errors, dry-run snapshots).

## Matching logic

1. Filter out competition / reserved rows and rows without a Book button.
2. For each preferred time in order, prefer an exact match.
3. If none, pick the earliest bookable row whose time falls within
   `[first_preferred, last_preferred]`.
4. When tied, prefer rows reporting more empty slots.

## Notes

- First real run usually needs a small selector tweak — DOM cannot be inspected
  before runtime. Use `npm run dry-run` first; the screenshot saved to
  `screenshots/dryrun-*.png` plus `logs/run-*.log` make it a one-iteration fix.
- Personal use only. Don't bulk-book-then-cancel.
