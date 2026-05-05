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
HEADLESS=1 npm run book   # no visible window (for servers / phone-driven VPS)
```

Set `"headless": true` in `config.json` to make headless the default, or use
the `HEADLESS=1` env var to override per-run.

A persistent Chromium profile is stored in `./user-data/` so login is reused
across runs. Logs go to `logs/run-<ts>.log`. Screenshots go to `screenshots/`
(success, errors, dry-run snapshots).

## Phone-only setup (run from a cloud VM)

You don't need a computer. Rent a tiny Linux VM in the cloud and SSH into it
from your phone.

**1. Pick a VPS** (any of these, ~£4–6/month):
- [Hetzner](https://www.hetzner.com/cloud) CX11 (cheapest, ~£4/mo)
- [DigitalOcean](https://www.digitalocean.com) Basic Droplet
- [Linode](https://www.linode.com) Nanode

Create an Ubuntu 24.04 server. Save the IP address and root password (or set up
an SSH key — providers walk you through it).

**2. Install an SSH app on your phone**
- iOS: **Termius** (free) or **Blink Shell**
- Android: **Termius** or **JuiceSSH**

Add a new host with your VM's IP, user `root`, and your password/key.

**3. Connect and install everything** (paste these into the SSH session):

```bash
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
git clone https://github.com/merrychristmaskevin/merrychristmaskevin.github.io.git ig-bot
cd ig-bot
git checkout claude/golf-booking-automation-17Tk8
npm install
npx playwright install --with-deps chromium
```

**4. Add your credentials**

```bash
cp .env.example .env
nano .env    # edit IG_USERNAME and IG_PASSWORD, Ctrl+O to save, Ctrl+X to exit
nano config.json   # set date, preferred_times, partners. Set "headless": true
```

**5. Test it (dry run)**

```bash
HEADLESS=1 npm run dry-run
```

Watch the log. Then download a screenshot to your phone to verify it found the
right slot:
- Termius has a built-in SFTP browser → grab files from `screenshots/`
- Or `cat screenshots/dryrun-*.png | base64` and paste into a base64-to-image
  site

**6. Real booking**

```bash
HEADLESS=1 npm run book
```

**7. Want it to run automatically at booking-release time?**

Schedule it with cron. Example: bookings open at 7:00am UK time and you want
the bot to start at 6:59am every day:

```bash
crontab -e
# add this line:
59 6 * * * cd /root/ig-bot && HEADLESS=1 /usr/bin/npm run book >> /root/ig-bot/logs/cron.log 2>&1
```

Set the VM's timezone first: `timedatectl set-timezone Europe/London`.

Enable `"preload": { "enabled": true, ... }` in `config.json` so the bot waits
for the exact release second.

**Reconnecting later:** just open Termius, tap the host, run `cd ig-bot && tail -f logs/run-*.log` to watch progress.

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
