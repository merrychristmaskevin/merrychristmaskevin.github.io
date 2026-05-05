'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config();

function targetDate() {
  if (process.argv[2]) return process.argv[2];
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const date = targetDate();
const LOG = path.join(__dirname, 'logs', 'monitor.log');
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'user-data'), { recursive: true });

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'user-data'), {
    headless: process.env.HEADLESS !== '0',
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(20000);

  try {
    await page.goto(`https://sudbury.intelligentgolf.co.uk/memberbooking/?date=${date}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(4000);

    const result = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || '';
      const hasSlotsText = /slots available/i.test(text);
      let bookCount = 0;
      for (const el of document.querySelectorAll('button, a')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^Book$/i.test(t)) bookCount++;
      }
      const loggedIn = !!document.querySelector('a[href*="logout"]');
      return { hasSlotsText, bookCount, loggedIn };
    });

    const line = `${new Date().toISOString()} date=${date} loggedIn=${result.loggedIn} bookCount=${result.bookCount} hasSlotsText=${result.hasSlotsText}\n`;
    process.stdout.write(line);
    fs.appendFileSync(LOG, line);
  } catch (e) {
    const line = `${new Date().toISOString()} date=${date} ERROR ${e.message}\n`;
    process.stdout.write(line);
    fs.appendFileSync(LOG, line);
  } finally {
    await ctx.close().catch(() => {});
  }
})();
