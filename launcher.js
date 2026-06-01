/**
 * AegisQA CLI Companion Launcher (launcher.js)
 *
 * Architecture: Direct CDP over Chrome Remote Debugging Port
 * ---------------------------------------------------------
 * 1. Launches Chrome with --remote-debugging-port=9222
 * 2. Polls http://localhost:9222/json/version until Chrome is ready
 * 3. Connects to the browser WebSocket endpoint
 * 4. Attaches a flat CDP session to the target tab (no re-emit recursion)
 * 5. Navigates, waits for Page.loadEventFired, then runs test steps
 * 6. Streams per-step telemetry to stdout with ANSI colour
 * 7. Writes report.json on completion, exits 0 (PASS) or 1 (FAIL)
 *
 * Usage:
 *   node launcher.js
 *   node launcher.js --url https://my-app.com
 *   node launcher.js --scenario ./suite.json
 *   node launcher.js --headless
 */

'use strict';

const { spawn }        = require('child_process');
const fs               = require('fs');
const path             = require('path');
const http             = require('http');
const { WebSocket }    = require('ws');
const { EventEmitter } = require('events');

// ─── CLI arguments ─────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const targetUrl    = getArg('--url')
  || 'file:///' + path.join(__dirname, 'test-app.html').replace(/\\/g, '/');
const scenarioPath = getArg('--scenario');
const isHeadless   = args.includes('--headless');

console.log('═══════════════════════════════════════════════════');
console.log('  ⚡  AegisQA Automated CLI Test Runner v2026.1  ⚡');
console.log('═══════════════════════════════════════════════════');
console.log(`  Target : ${targetUrl}`);
console.log(`  Mode   : ${isHeadless ? 'Headless' : 'Visible'}`);
console.log('───────────────────────────────────────────────────\n');

// ─── Default smoke suite ───────────────────────────────────────────────────────
const DEFAULT_STEPS = [
  { type: 'WAIT_FOR_VISIBLE',  selector: '#input-username',     timeout: 10000 },
  { type: 'TYPE',              selector: '#input-username',     text: 'LiveActionQA_Admin' },
  { type: 'TYPE',              selector: '#input-password',     text: 'SecretSafeToken2026' },
  { type: 'CLICK',             selector: '#btn-submit',         tagName: 'button' },
  { type: 'WAIT_FOR_VISIBLE',  selector: '#checkout-status',    timeout: 10000 },
  { type: 'ASSERT_TEXT',       selector: '#checkout-status',    text: 'Dashboard Active' },
  { type: 'CLICK',             selector: '#btn-trigger-action', tagName: 'button' },
  { type: 'WAIT_FOR_VISIBLE',  selector: '#toast-message',      timeout: 6000  },
  { type: 'ASSERT_VISIBLE',    selector: '#toast-message' },
  { type: 'ASSERT_TEXT',       selector: '#toast-message',      text: 'Operation Successful' },
];

let suiteSteps = DEFAULT_STEPS;
if (scenarioPath) {
  try {
    const raw    = fs.readFileSync(scenarioPath, 'utf8');
    const parsed = JSON.parse(raw);
    suiteSteps   = parsed.steps || parsed;
    console.log(`Loaded scenario: ${scenarioPath} (${suiteSteps.length} steps)\n`);
  } catch (e) {
    console.error(`[Error] Cannot read scenario: ${e.message}`);
    process.exit(1);
  }
} else {
  console.log(`Running default Smoke Suite (${suiteSteps.length} steps)\n`);
}

// ─── Launch Chrome ─────────────────────────────────────────────────────────────
const DEBUG_PORT = 9222;
const profileDir = path.join(__dirname, '.chrome-profile');
const chromeBin  = findChrome();

const chromeFlags = [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions-except=' + __dirname,
  '--load-extension='             + __dirname,
  targetUrl,
];
if (isHeadless) chromeFlags.push('--headless=new', '--disable-gpu');

console.log(`Launching: ${chromeBin}\n`);
const chrome = spawn(chromeBin, chromeFlags, { stdio: 'ignore', detached: false });
chrome.on('error', (err) => { console.error('[Fatal] Chrome failed to start:', err.message); process.exit(1); });

// ─── Main ──────────────────────────────────────────────────────────────────────
main().catch((err) => { console.error('\n[Fatal]', err.message); cleanupAndExit(1); });

async function main() {
  // 1. Wait for Chrome's remote debugger
  const wsUrl = await pollForChromeReady(DEBUG_PORT, 25000);

  // 2. Open a single WebSocket to the browser endpoint
  //    All CDP messages flow through this one socket.
  //    We use a custom EventEmitter so listener code never touches ws.emit().
  const events = new EventEmitter();
  events.setMaxListeners(50);

  const ws = await new Promise((res, rej) => {
    const sock = new WebSocket(wsUrl);
    sock.on('open',  () => res(sock));
    sock.on('error', rej);
    // Single message handler → resolves pending promises OR emits on 'events'
    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.id !== undefined && _pending.has(msg.id)) {
        // This is a response to a cdpSend() call
        const { res: resolve, rej: reject } = _pending.get(msg.id);
        _pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else {
        // This is an unsolicited CDP event — emit on our EventEmitter
        events.emit('cdpEvent', msg);
      }
    });
  });

  const send = (method, params = {}, sessionId) =>
    cdpSend(ws, method, params, sessionId);

  // 3. Find the page target (the one we opened with targetUrl)
  const { targetInfos } = await send('Target.getTargets');
  const pageTarget = targetInfos.find(
    t => t.type === 'page' && !t.url.startsWith('devtools://')
  );
  if (!pageTarget) throw new Error('No page target found after Chrome launch');

  // 4. Attach a flat session to that target
  const { sessionId } = await send('Target.attachToTarget',
    { targetId: pageTarget.targetId, flatten: true });

  // Helper: send scoped to our session
  const tab = (method, params = {}) => send(method, params, sessionId);

  // 5. Enable domains
  await tab('Page.enable');
  await tab('DOM.enable');
  await tab('Runtime.enable');
  await tab('Network.enable');

  // 6. Navigate fresh and wait for loadEventFired
  await tab('Page.navigate', { url: targetUrl });
  await waitForEvent(events, sessionId, 'Page.loadEventFired', 12000);
  await sleep(200); // brief settle after load

  // 7. Telemetry collectors
  const consoleLogs = [];
  const pendingReqs = new Set();
  events.on('cdpEvent', (ev) => {
    if (ev.sessionId !== sessionId) return;
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params?.type === 'error') {
      consoleLogs.push(ev.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (ev.method === 'Runtime.exceptionThrown') {
      consoleLogs.push(ev.params?.exceptionDetails?.exception?.description || '');
    }
    if (ev.method === 'Network.requestWillBeSent') pendingReqs.add(ev.params.requestId);
    if (ev.method === 'Network.loadingFinished')   pendingReqs.delete(ev.params.requestId);
    if (ev.method === 'Network.loadingFailed')     pendingReqs.delete(ev.params.requestId);
  });

  // 8. Execute test suite
  const t0       = Date.now();
  const results  = [];
  let   passed   = true;

  for (let i = 0; i < suiteSteps.length; i++) {
    const step  = suiteSteps[i];
    const idx   = i + 1;
    const start = Date.now();
    process.stdout.write(`  ${String(idx).padStart(2)}/${suiteSteps.length}  ${step.type.padEnd(18)} `);

    let status = 'PASS', error = null, evidence = null;
    try {
      await executeStep(tab, step, pendingReqs);
    } catch (err) {
      status = 'FAIL';
      error  = err.message;
      passed = false;
      evidence = await captureEvidence(tab, step.selector, consoleLogs);
    }

    const dur = Date.now() - start;
    console.log(`${status === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}  (${dur}ms)`);
    if (error) console.log(`       └─ ${error}`);

    results.push({
      stepIndex: idx,
      type: step.type,
      locator: { primary: step.selector || '', fallbacks: [] },
      status,
      startedAt: new Date(start).toISOString(),
      endedAt:   new Date().toISOString(),
      durationMs: dur,
      error: error || null,
      evidence,
    });

    if (!passed) break; // ← Circuit-breaker: halt on first failure
  }

  const totalMs = Date.now() - t0;
  const passN   = results.filter(r => r.status === 'PASS').length;
  const failN   = results.filter(r => r.status === 'FAIL').length;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  RESULT : ${passed ? '\x1b[32mPASS ✓\x1b[0m' : '\x1b[31mFAIL ✗\x1b[0m'}`);
  console.log(`  Steps  : ${suiteSteps.length}  |  ✓ ${passN}  |  ✗ ${failN}  |  ${totalMs}ms`);
  console.log('═══════════════════════════════════════════════════\n');

  // 9. Write report.json
  const failStep = results.find(r => r.status === 'FAIL');
  const report = {
    $schema: 'https://liveaction.qa/schemas/v1/report.schema.json',
    testSuiteMetadata: {
      runnerVersion: 'LiveAction-CDP-2026.1',
      executedAt:    new Date().toISOString(),
      summary: { totalSteps: suiteSteps.length, passed: passN, failed: failN, durationMs: totalMs },
    },
    steps: results,
    agentRepairPacket: failStep ? buildRepairPacket(failStep, results) : null,
  };
  const reportPath = path.join(__dirname, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  Diagnostics → ${reportPath}\n`);

  ws.close();
  cleanupAndExit(passed ? 0 : 1);
}

// ─── Step executor ─────────────────────────────────────────────────────────────
async function executeStep(tab, step, pendingReqs) {
  await sleep(60); // micro-settle before each action

  if (step.type === 'NAVIGATE') {
    await tab('Page.navigate', { url: step.selector });
    await waitForNetworkIdle(pendingReqs, 8000);
    return;
  }

  if (step.type.startsWith('WAIT_FOR')) {
    await runWait(tab, step, pendingReqs);
    return;
  }

  if (step.type.startsWith('ASSERT_')) {
    await runAssert(tab, step);
    return;
  }

  // ── Interactive ──
  const loc = await locate(tab, step.selector);
  if (!loc || !loc.visible) {
    throw new Error(`Element not found/visible: "${step.selector}"`);
  }

  if (step.type === 'CLICK' || step.type === 'CHECK' || step.type === 'UNCHECK') {
    await jsExec(tab, step.selector, `el.scrollIntoView({block:'center'})`);
    await sleep(100);
    // Re-locate after scroll so coordinates are fresh
    const loc2 = await locate(tab, step.selector);
    const cx = (loc2 && loc2.visible) ? loc2.x : loc.x;
    const cy = (loc2 && loc2.visible) ? loc2.y : loc.y;
    await tab('Input.dispatchMouseEvent', { type: 'mousePressed',  x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(60);
    await tab('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    // Fallback: also dispatch JS click to guarantee event handlers fire
    await jsExec(tab, step.selector, `el.click()`);
    await sleep(400); // Allow DOM mutations (class toggles etc.) to settle
  }

  else if (step.type === 'TYPE') {
    // Set value directly via JS — CDP key dispatch alone doesn't update el.value reliably.
    // This matches how Playwright/Puppeteer handle inputs under CDP.
    await jsExec(tab, step.selector,
      `el.focus(); ` +
      `el.value = ${JSON.stringify(step.text)}; ` +
      `el.dispatchEvent(new Event('input',  { bubbles: true })); ` +
      `el.dispatchEvent(new Event('change', { bubbles: true })); ` +
      `el.dispatchEvent(new Event('blur',   { bubbles: true }))`
    );
    await sleep(100);
  }
}

// ─── Wait strategies ───────────────────────────────────────────────────────────
async function runWait(tab, step, pendingReqs) {
  const timeout  = step.timeout || 5000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    let ok = false;
    if      (step.type === 'WAIT_FOR_VISIBLE')      { const l = await locate(tab, step.selector); ok = !!(l && l.visible); }
    else if (step.type === 'WAIT_FOR_HIDDEN')        { const l = await locate(tab, step.selector); ok = !l || !l.visible; }
    else if (step.type === 'WAIT_FOR_NETWORK_IDLE')  { ok = pendingReqs.size === 0; }
    if (ok) return;
    await sleep(120);
  }
  throw new Error(`Wait timed out (${timeout}ms): ${step.type} → "${step.selector}"`);
}

// ─── Assertions ────────────────────────────────────────────────────────────────
async function runAssert(tab, step) {
  const loc = await locate(tab, step.selector);

  if (step.type === 'ASSERT_VISIBLE') {
    if (!loc || !loc.visible) throw new Error(`Expected visible: "${step.selector}"`);
    return;
  }
  if (step.type === 'ASSERT_HIDDEN') {
    if (loc && loc.visible) throw new Error(`Expected hidden: "${step.selector}"`);
    return;
  }
  if (!loc || !loc.visible) throw new Error(`Assert target not found/visible: "${step.selector}"`);

  if (step.type === 'ASSERT_TEXT') {
    const txt = await getProperty(tab, step.selector, 'innerText');
    if (!txt || !txt.toLowerCase().includes(step.text.toLowerCase()))
      throw new Error(`ASSERT_TEXT: expected "${step.text}", found "${txt}"`);
  } else if (step.type === 'ASSERT_VALUE') {
    const val = await getProperty(tab, step.selector, 'value');
    if (val !== step.text) throw new Error(`ASSERT_VALUE: expected "${step.text}", found "${val}"`);
  } else if (step.type === 'ASSERT_ENABLED') {
    const dis = await getProperty(tab, step.selector, 'disabled');
    if (dis) throw new Error('ASSERT_ENABLED: element is disabled');
  } else if (step.type === 'ASSERT_DISABLED') {
    const dis = await getProperty(tab, step.selector, 'disabled');
    if (!dis) throw new Error('ASSERT_DISABLED: element is enabled');
  }
}

// ─── DOM helpers (shadow-piercing) ────────────────────────────────────────────
const PIERCE = `
  function pq(root, sel) {
    let el = root.querySelector(sel);
    if (el) return el;
    for (const c of root.querySelectorAll('*')) {
      if (c.shadowRoot) { const f = pq(c.shadowRoot, sel); if (f) return f; }
      if (c.tagName === 'IFRAME') { try { const f = pq(c.contentDocument, sel); if (f) return f; } catch {} }
    }
    return null;
  }
`;

async function locate(tab, selector) {
  // Uses Element.checkVisibility() (Chrome 105+) which correctly handles display:none on ancestors
  const expr = `(function(){${PIERCE}
    const el = pq(document, ${JSON.stringify(selector)});
    if (!el) return null;
    const visible = el.checkVisibility
      ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
      : (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, width: r.width, height: r.height, visible };
  })()`;
  const res = await tab('Runtime.evaluate', { expression: expr, returnByValue: true });
  return res?.result?.value || null;
}

async function jsExec(tab, selector, code) {
  const expr = `(function(){${PIERCE}
    const el = pq(document, ${JSON.stringify(selector)});
    if (el) { ${code} }
  })()`;
  await tab('Runtime.evaluate', { expression: expr });
}

async function getProperty(tab, selector, prop) {
  const expr = `(function(){${PIERCE}
    const el = pq(document, ${JSON.stringify(selector)});
    return el ? el[${JSON.stringify(prop)}] : null;
  })()`;
  const res = await tab('Runtime.evaluate', { expression: expr, returnByValue: true });
  return res?.result?.value ?? null;
}

async function waitForNetworkIdle(pendingReqs, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pendingReqs.size === 0) { await sleep(200); return; }
    await sleep(150);
  }
}

// ─── Evidence capture ──────────────────────────────────────────────────────────
async function captureEvidence(tab, selector, consoleLogs) {
  let screenshot = null, domExcerpt = null;
  try {
    const ss = await tab('Page.captureScreenshot', { format: 'png', quality: 60 });
    if (ss?.data) screenshot = `data:image/png;base64,${ss.data}`;
  } catch {}
  try {
    const expr = `(function(){${PIERCE}
      const el = pq(document, ${JSON.stringify(selector)});
      return el ? el.outerHTML.substring(0, 1200) : 'Element not found in DOM at failure moment.';
    })()`;
    const res = await tab('Runtime.evaluate', { expression: expr, returnByValue: true });
    domExcerpt = res?.result?.value || null;
  } catch {}
  return { screenshot, domExcerpt, consoleErrors: [...consoleLogs] };
}

// ─── AI Agent repair packet ────────────────────────────────────────────────────
function buildRepairPacket(failStep, allSteps) {
  return {
    failureClass: failStep.error?.includes('timeout') ? 'element_hidden' : 'selector_missing',
    plainEnglishSummary:
      `Suite halted at Step ${failStep.stepIndex} (${failStep.type}) — ` +
      `selector "${failStep.locator.primary}" could not be resolved or asserted.`,
    reproductionSteps: allSteps.map((s, i) => `${i + 1}. ${s.type} → "${s.locator.primary}"`),
    likelyRootCause:
      'The target element is absent, rendered asynchronously without a prior wait, ' +
      'or its identifier changed dynamically.',
    recommendedInspectionTargets: [failStep.locator.primary],
    blockingEvidence: [
      `Error: ${failStep.error}`,
      `DOM at failure: ${failStep.evidence?.domExcerpt || 'N/A'}`,
    ],
    acceptanceCriteriaForFix: [
      `Ensure element matching "${failStep.locator.primary}" is present and visible before the action.`,
      'Re-run AegisQA CLI; all steps must show ✓ PASS.',
    ],
  };
}

// ─── CDP primitives ────────────────────────────────────────────────────────────
let _msgId = 1;
const _pending = new Map();

function cdpSend(ws, method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id      = _msgId++;
    _pending.set(id, { res, rej });
    const payload = JSON.stringify({
      id, method, params,
      ...(sessionId ? { sessionId } : {}),
    });
    ws.send(payload);
  });
}

function waitForEvent(events, sessionId, eventMethod, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs); // resolve even if event never fires
    function handler(ev) {
      if (ev.sessionId === sessionId && ev.method === eventMethod) {
        clearTimeout(timer);
        events.removeListener('cdpEvent', handler);
        resolve();
      }
    }
    events.on('cdpEvent', handler);
  });
}

// ─── Chrome discovery ──────────────────────────────────────────────────────────
function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return 'chrome';
}

// ─── Chrome ready poller ───────────────────────────────────────────────────────
function pollForChromeReady(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      if (Date.now() > deadline) return reject(new Error('Chrome debugger did not start in time'));
      http.get(`http://localhost:${port}/json/version`, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try   { resolve(JSON.parse(body).webSocketDebuggerUrl); }
          catch { setTimeout(attempt, 500); }
        });
      }).on('error', () => setTimeout(attempt, 500));
    }
    attempt();
  });
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getArg(flag) {
  const i = args.indexOf(flag);
  return i > -1 && args[i + 1] ? args[i + 1] : null;
}

function cleanupAndExit(code) {
  try { chrome.kill(); } catch {}
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(code), 600);
}
