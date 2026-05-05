'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config();

const BASE_URL = 'https://sudbury.intelligentgolf.co.uk';
const TEE_URL = `${BASE_URL}/memberbooking/`;
const LOGIN_URL = `${BASE_URL}/login.php`;
const DRY_RUN = process.argv.includes('--dry-run');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const TIMEZONE = process.env.TZ || 'Europe/London';

const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-');
ensureDirs(['screenshots', 'logs', 'user-data']);
const LOG_PATH = path.join('logs', `run-${RUN_TS}.log`);
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function ensureDirs(dirs) {
  for (const d of dirs) {
    fs.mkdirSync(path.join(__dirname, d), { recursive: true });
  }
}

function ts() {
  return new Date().toISOString();
}

function log(level, msg) {
  const line = `[${level}] ${ts()} ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}
const info = (m) => log('INFO', m);
const success = (m) => log('SUCCESS', m);
const warn = (m) => log('WARN', m);
const errlog = (m) => log('ERROR', m);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
async function randomDelay(min = 500, max = 1500) { await sleep(rand(min, max)); }
function jitter(ms, pct = 0.2) { return ms + Math.floor((Math.random() * 2 - 1) * ms * pct); }

async function humanType(locator, text) {
  await locator.click();
  for (const ch of text) {
    await locator.type(ch, { delay: rand(40, 120) });
  }
}

function timeToMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

async function ensureLoggedIn(page) {
  info('Navigating to member booking');
  await page.goto(TEE_URL, { waitUntil: 'domcontentloaded' });
  await randomDelay();

  if (await isOnTeeSheet(page)) {
    info('Existing session detected, skipping login');
    return;
  }

  info('Logging in');
  if (!(await page.locator('input[name="memberid"], input[name="username"]').first().isVisible().catch(() => false))) {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await randomDelay();
  }

  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;
  if (!username || !password) throw new Error('IG_USERNAME / IG_PASSWORD not set in .env');

  await humanType(page.locator('input[name="memberid"], input[name="username"]').first(), username);
  await randomDelay(200, 500);
  await humanType(page.locator('input[name="pin"], input[name="password"]').first(), password);
  await randomDelay(200, 500);

  const submit = page.locator(
    'input[type="submit"][value="Login"], button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")'
  ).first();
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    submit.click(),
  ]);
  await randomDelay();

  if (!(await isLoggedIn(page))) {
    const shot = `screenshots/login-fail-${ts().replace(/[:.]/g, '-')}.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`Login failed (screenshot: ${shot})`);
  }
  info('Logged in');
}

async function isLoggedIn(page) {
  return (await page.locator('a:has-text("Logout"), a:has-text("Log out"), a[href*="logout"]').first().isVisible().catch(() => false))
    || (await isOnTeeSheet(page));
}

async function isOnTeeSheet(page) {
  const selectors = ['table.teesheet', 'table#teesheet', '.teetimes', 'table.bookingtable', '[data-time]'];
  for (const sel of selectors) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

async function gotoTeeSheet(page, dateStr) {
  info(`Loading tee sheet for ${dateStr}`);
  const candidates = [
    `${TEE_URL}index.php?date=${dateStr}`,
    `${TEE_URL}?date=${dateStr}`,
    `${TEE_URL}index.php?selected_date=${dateStr}`,
  ];
  let loaded = false;
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (await waitForTeeSheet(page, 8000)) { loaded = true; break; }
    } catch (_) { /* try next */ }
  }
  if (!loaded) {
    await page.goto(TEE_URL, { waitUntil: 'domcontentloaded' });
    if (!(await waitForTeeSheet(page, 15000))) {
      await dumpDebug(page, 'no-teesheet');
      throw new Error('Tee sheet did not appear');
    }
    await navigateToDateViaUI(page, dateStr);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await randomDelay();
}

async function waitForTeeSheet(page, timeout = 15000) {
  try {
    await page.waitForFunction(() => {
      const text = document.body && document.body.innerText || '';
      return /\bBook\b/.test(text) && /\b\d{1,2}:\d{2}\b/.test(text);
    }, { timeout });
    return true;
  } catch (_) {
    return false;
  }
}

async function navigateToDateViaUI(page, dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  for (let i = 0; i < 60; i++) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (matchesDate(bodyText, target)) return;
    const nextBtn = page.locator(
      'a:has-text("→"), button:has-text("→"), a:has-text("›"), a:has-text("Next"), a.next, a[title*="next" i], a[aria-label*="next" i], a[onclick*="next" i], a[href*="next" i]'
    ).first();
    if (!(await nextBtn.isVisible().catch(() => false))) {
      info('No next-day arrow found, stopping date navigation');
      break;
    }
    await nextBtn.click();
    await randomDelay(600, 1200);
    await waitForTeeSheet(page, 5000);
  }
}

function matchesDate(text, dateObj) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const m = months[dateObj.getMonth()];
  return text.includes(`${dateObj.getDate()} ${m}`) || text.includes(`${m} ${dateObj.getDate()}`);
}

async function parseTeeSheet(page) {
  const bookLocator = page.locator('a, button, input[type="submit"], input[type="button"]').filter({ hasText: /^\s*Book\s*$/i });
  const count = await bookLocator.count();

  const parsed = [];
  for (let i = 0; i < count; i++) {
    const btn = bookLocator.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;

    const rowText = await btn.evaluate((el) => {
      let cur = el.parentElement;
      while (cur && cur !== document.body) {
        const text = cur.innerText || '';
        if (/\b\d{1,2}:\d{2}\b/.test(text)) return text;
        cur = cur.parentElement;
      }
      return '';
    }).catch(() => '');

    const timeMatch = rowText.match(/\b(\d{1,2}:\d{2})\b/);
    if (!timeMatch) continue;
    const time = timeMatch[1].padStart(5, '0');

    const availabilityText = rowText.replace(/\s+/g, ' ').slice(0, 200);
    const isCompetition = /competition|reserved|society|outing|matchplay|comp\b/i.test(availabilityText);
    const slotsMatch = availabilityText.toLowerCase().match(/(\d+)\s*slot/);

    parsed.push({
      time,
      availabilityText,
      isCompetition,
      hasBookButton: true,
      slotsAvailable: slotsMatch ? parseInt(slotsMatch[1], 10) : null,
      bookLocator: btn,
    });
  }
  return parsed;
}

async function dumpDebug(page, label) {
  const t = ts().replace(/[:.]/g, '-');
  try {
    const html = await page.content();
    fs.writeFileSync(path.join('logs', `debug-${label}-${t}.html`), html);
    await page.screenshot({ path: `screenshots/debug-${label}-${t}.png`, fullPage: true });
    info(`Saved debug HTML and screenshot (label=${label})`);
  } catch (_) {}
}

function pickTarget(rows, preferredTimes) {
  const bookable = rows.filter((r) => r.hasBookButton && !r.isCompetition);
  if (bookable.length === 0) return null;

  for (const pref of preferredTimes) {
    const exact = bookable
      .filter((r) => r.time === pref)
      .sort((a, b) => slotsRank(b) - slotsRank(a));
    if (exact.length) return exact[0];
  }

  const prefMins = preferredTimes.map(timeToMinutes).filter((v) => v !== null).sort((a, b) => a - b);
  if (prefMins.length === 0) return null;
  const lo = prefMins[0];
  const hi = prefMins[prefMins.length - 1];

  const inWindow = bookable
    .map((r) => ({ r, m: timeToMinutes(r.time) }))
    .filter(({ m }) => m !== null && m >= lo && m <= hi)
    .sort((a, b) => a.m - b.m || slotsRank(b.r) - slotsRank(a.r));
  return inWindow.length ? inWindow[0].r : null;
}

function slotsRank(row) {
  if (row.slotsAvailable !== null) return row.slotsAvailable;
  return /available|free|empty/i.test(row.availabilityText) ? 1 : 0;
}

async function bookSlot(page, target, partners) {
  info(`Attempting to book ${target.time}`);
  await target.bookLocator.click();

  const modalAppeared = await page.waitForSelector(
    'form.bookingform, #bookingmodal, form[name="bookingform"], h1:has-text("Booking"), h2:has-text("Booking"), input[name^="player"]',
    { timeout: 10000 }
  ).then(() => true).catch(() => false);
  if (!modalAppeared) {
    warn('Booking form did not appear');
    return false;
  }
  await randomDelay();

  for (const name of partners || []) {
    const added = await addPartner(page, name);
    if (!added) warn(`Could not add partner "${name}", continuing`);
    await randomDelay();
  }

  if (DRY_RUN) {
    info('Dry run: skipping final confirm click');
    const dryShot = `screenshots/dryrun-${ts().replace(/[:.]/g, '-')}.png`;
    await page.screenshot({ path: dryShot, fullPage: true }).catch(() => {});
    return false;
  }

  const confirm = page.locator(
    'button:has-text("Confirm Booking"), button:has-text("Complete booking"), button:has-text("Confirm"), input[value*="Confirm" i], input[value*="Complete" i]'
  ).first();
  await confirm.click();

  const confirmed = await page.waitForSelector(
    'text=/successfully booked|booking confirmed|confirmation|your booking has been/i',
    { timeout: 15000 }
  ).then(() => true).catch(() => false);

  if (!confirmed) {
    warn('Confirmation marker not found');
    return false;
  }

  const confirmationText = await page.locator('main, .container, body').first().innerText().catch(() => '');
  const confTs = ts().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join('logs', `confirmation-${confTs}.txt`), confirmationText);
  await page.screenshot({ path: `screenshots/success-${confTs}.png`, fullPage: true }).catch(() => {});
  return true;
}

async function addPartner(page, name) {
  const slot = page.locator('input[name^="player"], input[placeholder*="player" i], input[placeholder*="name" i]')
    .filter({ hasNot: page.locator(':disabled') })
    .filter({ has: page.locator('xpath=self::*[not(@value) or @value=""]') })
    .first();

  const target = (await slot.count()) > 0
    ? slot
    : page.locator('input[name^="player"], input[placeholder*="player" i]').first();

  if (!(await target.isVisible().catch(() => false))) return false;

  await humanType(target, name);
  await randomDelay(400, 900);

  const suggestion = page.locator(
    `ul.ui-autocomplete li:has-text("${name}"), .autocomplete-suggestion:has-text("${name}"), li[role="option"]:has-text("${name}")`
  ).first();
  if (await suggestion.isVisible().catch(() => false)) {
    await suggestion.click();
    return true;
  }
  await target.press('Enter').catch(() => {});
  return true;
}

async function waitUntilPreload(cfg) {
  if (!cfg.preload || !cfg.preload.enabled) return;
  const { release_time_local, lead_seconds } = cfg.preload;
  const [hh, mm] = release_time_local.split(':').map((x) => parseInt(x, 10));
  const target = nextLocalTime(hh, mm, TIMEZONE);
  const startAt = target - (lead_seconds * 1000);
  const now = Date.now();
  if (startAt > now) {
    info(`Pre-load waiting until ${new Date(startAt).toISOString()} (release at ${new Date(target).toISOString()})`);
    await sleep(startAt - now);
  }
  info('Pre-load active');
}

function nextLocalTime(hh, mm, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const todayLocalIso = `${parts.year}-${parts.month}-${parts.day}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
  const guess = Date.parse(todayLocalIso);
  return guess > Date.now() ? guess : guess + 24 * 60 * 60 * 1000;
}

async function preloadRefreshLoop(page, cfg) {
  if (!cfg.preload || !cfg.preload.enabled) return;
  const interval = cfg.preload.refresh_interval_ms || 1000;
  const deadline = Date.now() + (cfg.preload.lead_seconds + 5) * 1000;
  while (Date.now() < deadline) {
    if (await waitForTeeSheet(page, 500)) return;
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(interval);
  }
}

async function main() {
  info(`Starting (dry-run=${DRY_RUN}, date=${CONFIG.date})`);
  const headless = process.env.HEADLESS === '1' || CONFIG.headless === true;
  const context = await chromium.launchPersistentContext(path.join(__dirname, 'user-data'), {
    headless,
    viewport: headless ? { width: 1280, height: 900 } : null,
    args: headless ? [] : ['--start-maximized'],
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await waitUntilPreload(CONFIG);

    for (let attempt = 1; attempt <= CONFIG.max_retries; attempt++) {
      info(`Attempt ${attempt}/${CONFIG.max_retries}`);
      try {
        await ensureLoggedIn(page);
        if (CONFIG.preload && CONFIG.preload.enabled && attempt === 1) {
          await preloadRefreshLoop(page, CONFIG);
        }
        await gotoTeeSheet(page, CONFIG.date);

        const rows = await parseTeeSheet(page);
        info(`Parsed ${rows.length} rows`);
        for (const r of rows.slice(0, 30)) {
          info(`  ${r.time}  comp=${r.isCompetition}  book=${r.hasBookButton}  slots=${r.slotsAvailable ?? '-'}  | ${r.availabilityText.slice(0, 80)}`);
        }

        const target = pickTarget(rows, CONFIG.preferred_times);
        if (!target) {
          warn('No matching bookable row');
          await sleep(jitter(CONFIG.retry_interval_seconds * 1000));
          continue;
        }
        info(`Found match: ${target.time} (slots=${target.slotsAvailable ?? '-'})`);

        const ok = await bookSlot(page, target, CONFIG.partners);
        if (ok) {
          success(`Booked tee time ${target.time}`);
          await context.close();
          return;
        }
        warn('Booking attempt did not confirm');
      } catch (e) {
        errlog(e.stack || e.message || String(e));
        await page.screenshot({ path: `screenshots/error-${ts().replace(/[:.]/g, '-')}.png`, fullPage: true }).catch(() => {});
      }
      await sleep(jitter(CONFIG.retry_interval_seconds * 1000));
    }

    errlog('Exhausted retries without booking');
  } finally {
    await context.close().catch(() => {});
    logStream.end();
  }
}

main().catch((e) => {
  errlog(e.stack || e.message || String(e));
  process.exit(1);
});
