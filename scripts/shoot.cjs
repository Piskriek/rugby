/* shoot.cjs — drive the real game in a headless browser and show me what it looks like.
 *
 * Every other harness in this repo measures the simulation, because for two months
 * there was no browser in this sandbox and a screenshot was not something I could
 * take. This one exists so that "it looks wrong" can be answered with a picture and a
 * console dump instead of an argument: it clicks through the menus into a live match,
 * waits for the world to boot, writes PNGs, and prints every console line, page error
 * and failed request the page produced. WebGL is software (SwiftShader) via the lambda
 * chromium build, so it is slow; the numbers it shows are not a performance measure,
 * the PICTURES are the point.
 *
 *   node scripts/shoot.cjs [.arena/shots] [ms-per-scene] [scene]
 */
const fs = require('node:fs');
const path = require('node:path');
const chromium = require('@sparticuz/chromium').default;
const puppeteer = require('puppeteer-core');

const outDir = process.argv[2] || '.arena/shots';
const holdMs = Number(process.argv[3] || 9000);
const scene = process.argv[4] || 'match';
const url = process.env.SHOOT_URL || 'http://127.0.0.1:5173/';

const log = [];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      ...chromium.args,
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--window-size=1280,800', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: 240000,
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = `[console:${m.type()}] ${m.text()}`;
    log.push(t);
    if (m.type() === 'error' || m.type() === 'warning') console.log(t.slice(0, 400));
  });
  page.on('pageerror', (e) => { const t = `[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`; log.push(t); console.log(t); });
  page.on('requestfailed', (r) => { const t = `[reqfail] ${r.url()} — ${r.failure() && r.failure().errorText}`; log.push(t); console.log(t); });
  page.on('response', (r) => { if (r.status() >= 400) { const t = `[http ${r.status()}] ${r.url()}`; log.push(t); console.log(t); } });

  console.log('→ goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!document.querySelector('canvas'), { timeout: 30000 }).catch(() => console.log('no canvas at all'));

  const probe = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return 'NO WEBGL CONTEXT';
    return `${g.getParameter(g.VERSION)} | ${g.getParameter(g.RENDERER)} | maxTex ${g.getParameter(g.MAX_TEXTURE_SIZE)}`;
  });
  console.log('WEBGL:', probe);

  const click = async (rx, settle = 900) => {
    const ok = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const els = Array.from(document.querySelectorAll('button,a,[role=button]'));
      const el = els.find((e) => re.test((e.textContent || '').trim()));
      if (!el) return false;
      el.click();
      return true;
    }, rx.source);
    console.log(ok ? `  clicked ${rx}` : `  (no button matching ${rx})`);
    await new Promise((r) => setTimeout(r, settle));
    return ok;
  };

  const seen = async (label) => {
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 240));
    console.log(`  screen[${label}]: ${t}`);
  };

  await seen('title');
  await click(/PRESS FIRE TO CONTINUE/);
  await seen('mode');
  await click(/FRIENDLY/);
  await seen('teams');
  await click(/TO THE SQUAD SHEET/);
  await seen('squad');
  await click(/CONFIRM FIFTEEN/);
  await seen('tactics');
  await click(/TAKE THE FIELD/);

  // The world boots in stages behind a loading screen; wait for it to clear.
  console.log('  waiting for the loading screen to clear…');
  await page.waitForFunction(() => !/PREPARING THE GROUND|RAISING THE STANDS|NAMING THE SQUADS|BRINGING OUT THE TEAMS/i.test(document.body.innerText), { timeout: 180000 })
    .then(() => console.log('  world is up'))
    .catch((e) => console.log('  loading screen never cleared:', e.message.split('\n')[0]));

  const stats = async (label) => {
    const s = await page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('canvas'));
      return cs.map((c) => ({
        w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight,
        cls: (c.className || '').slice(0, 40),
        ctx: c.getContext ? 'canvas' : '',
      }));
    });
    console.log(`  canvases[${label}]:`, JSON.stringify(s));
  };
  await stats('boot');

  await new Promise((r) => setTimeout(r, holdMs));
  await stats('live');
  await page.screenshot({ path: path.join(outDir, `${scene}-a.png`) });
  // let the match run a bit so there is contact to see
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('KeyD');
  await new Promise((r) => setTimeout(r, 1400));
  await page.keyboard.press('KeyA');
  await new Promise((r) => setTimeout(r, 1400));
  await page.keyboard.up('ShiftLeft');
  await page.screenshot({ path: path.join(outDir, `${scene}-b.png`) });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(outDir, `${scene}-c.png`) });
  await stats('end');

  console.log(`\nwrote ${outDir}/${scene}-{a,b,c}.png`);
  fs.writeFileSync(path.join(outDir, `${scene}-console.txt`), log.join('\n'));
  console.log(`console lines: ${log.length}`);
  await browser.close();
}

main().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(1); });
