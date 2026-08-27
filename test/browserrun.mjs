// Drive the real game in a real browser.
//
// dom.js proves the engine does not throw; test/shot.js proves what the flat
// renderer draws. Neither can touch WebGL, a service worker, a dynamic import
// or a module graph served by Vite - which is most of what can go wrong in
// front of a player and nowhere else. This opens the page, walks into a battle
// and reports every console error, failed request and page exception WITH its
// stack, which is the thing the red bar at the bottom of the screen cannot show.
//
//   npm run preview            # or npm run dev, on whatever port it lands
//   npm run browser -- --url http://127.0.0.1:4173/ --shot shot.png --zoom 9
//
// Needs playwright, which is NOT a dependency of the game - only this wants it:
//
//   npm i --no-save playwright && npx playwright install chromium
import { chromium } from 'playwright';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};

const url = arg('url', 'http://localhost:4173/');
const shot = arg('shot', null);
const wantView = arg('view', '3d');

const browser = await chromium.launch({
  channel: 'chromium',   // the full build, not the headless shell
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const problems = [];
page.on('pageerror', (e) => problems.push('PAGE ERROR: ' + (e.stack || e.message)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type().toUpperCase() + ': ' + m.text());
});
page.on('response', (r) => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ': ' + r.url()); });
page.on('requestfailed', (r) => problems.push('REQUEST FAILED: ' + r.url() + ' ' + (r.failure() || {}).errorText));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await wait(2500); // the 3D chunk loads on demand

  const gl = await page.evaluate(() => {
    try {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl2');
      if (!g) return 'no webgl2';
      return g.getParameter(g.VERSION) + ' | ' + g.getParameter(g.RENDERER);
    } catch (e) {
      return 'threw: ' + e.message;
    }
  });
  console.log('WEBGL: ' + gl);
  console.log('BUILD: ' + (await page.evaluate(() => {
    const s = document.querySelector('.stamp, #stamp, .build');
    return (s && s.textContent) || (typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'unknown');
  }).catch(() => 'unknown')));

  // Straight into a battle, through the real UI.
  await page.evaluate(() => window.__seed && window.__seed(4242));
  await page.click('#mapPick [data-map="villages"]');
  await page.click('#startVeil [data-budget="2000"]');
  await wait(500);
  await page.click('#autoDep');
  await wait(400);
  console.log('AFTER DEPLOY: fault=' + (await page.evaluate(() => {
    const f = document.getElementById('fault');
    return f ? f.textContent : 'none';
  })));

  await page.click('#startBattle');
  await wait(3500);

  const state = await page.evaluate(() => {
    const f = document.getElementById('fault');
    return {
      fault: f ? f.textContent : null,
      cv: document.getElementById('cv').style.display,
      gl: document.getElementById('gl').style.display,
      ov: document.getElementById('ov').style.display,
      glSize: (() => { const c = document.getElementById('gl'); return c.width + 'x' + c.height; })(),
    };
  });
  console.log('AFTER BATTLE STARTS: ' + JSON.stringify(state, null, 1));

  if (wantView === '3d' && state.gl !== 'block') {
    // try switching by hand, and see what it says
    await page.evaluate(() => {
      const b = document.getElementById('menuBtn');
      if (b) b.click();
    });
    await wait(300);
    await page.evaluate(() => {
      const b = document.getElementById('mView');
      if (b) b.click();
    });
    await wait(2500);
    console.log('AFTER MANUAL SWITCH: ' + JSON.stringify(await page.evaluate(() => ({
      fault: (document.getElementById('fault') || {}).textContent || null,
      gl: document.getElementById('gl').style.display,
      view: (document.getElementById('mView') || {}).textContent,
    })), null, 1));
    await page.evaluate(() => {
      const b = document.getElementById('mResume');
      if (b) b.click();
    });
    await wait(1500);
  }

  // Close in on the deployment, where the men actually are.
  const zoom = parseInt(arg('zoom', '0'), 10);
  if (zoom) {
    const px = parseInt(arg('px', '420'), 10), py = parseInt(arg('py', '500'), 10);
    for (let i = 0; i < zoom; i++) {
      await page.mouse.move(px, py);
      await page.mouse.wheel(0, -240);
      await wait(90);
    }
    await wait(900);
    const after = await page.evaluate(() => {
      const f = document.getElementById('fault');
      return {
        fault: f ? f.textContent : null,
        cam: window.__cam ? window.__cam() : null,
        men: window.__stuck ? window.__stuck().live : null,
      };
    });
    console.log('AFTER ZOOM: ' + JSON.stringify(after));
  }
  if (shot) {
    await page.screenshot({ path: shot });
    console.log('SHOT: ' + shot);
  }
} catch (e) {
  problems.push('DRIVER: ' + (e.stack || e.message));
}

console.log('--- problems (' + problems.length + ') ---');
for (const p of problems.slice(0, 25)) console.log(p);
await browser.close();
