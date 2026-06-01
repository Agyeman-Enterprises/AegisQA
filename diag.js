'use strict';
/**
 * Diagnostic script - tests the click handler directly via CDP
 */
const http = require('http');
const { WebSocket } = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--remote-debugging-port=9226',
  '--user-data-dir=' + path.join(__dirname, '.diag2'),
  '--no-first-run',
  'file:///' + path.join(__dirname, 'test-app.html').replace(/\\/g, '/')
], { stdio: 'ignore' });

let msgId = 1;
const pending = new Map();

function send(ws, method, params, sessionId) {
  return new Promise((res, rej) => {
    const id = msgId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
  });
}

function poll(n) {
  if (n > 30) { chrome.kill(); process.exit(1); }
  setTimeout(() => {
    http.get('http://localhost:9226/json/version', (res) => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => {
        try { runTest(JSON.parse(b).webSocketDebuggerUrl); } catch { poll(n + 1); }
      });
    }).on('error', () => poll(n + 1));
  }, 700);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTest(wsUrl) {
  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(wsUrl);
    s.on('open', () => res(s));
    s.on('error', rej);
    s.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        const { res: r, rej: j } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? j(new Error(msg.error.message)) : r(msg.result);
      }
    });
  });

  const { targetInfos } = await send(ws, 'Target.getTargets');
  const page = targetInfos.find(t => t.type === 'page');
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const tab = (m, p) => send(ws, m, p || {}, sessionId);

  await tab('Page.enable');
  await tab('Runtime.enable');
  await tab('Page.navigate', { url: 'file:///' + path.join(__dirname, 'test-app.html').replace(/\\/g, '/') });
  await sleep(2000);

  // Step 1: Set input values directly
  const r1 = await tab('Runtime.evaluate', {
    expression: `(function() {
      const u = document.getElementById('input-username');
      const p = document.getElementById('input-password');
      if (u) u.value = 'TestUser';
      if (p) p.value = 'TestPass';
      return { u: u ? u.value : 'NOT FOUND', p: p ? p.value : 'NOT FOUND' };
    })()`,
    returnByValue: true
  });
  console.log('1. Input values:', JSON.stringify(r1.result.value));

  // Step 2: Click the button
  const r2 = await tab('Runtime.evaluate', {
    expression: `(function() {
      const btn = document.getElementById('btn-submit');
      if (!btn) return 'btn NOT FOUND';
      btn.click();
      return 'clicked OK';
    })()`,
    returnByValue: true
  });
  console.log('2. Click result:', r2.result.value);
  await sleep(600);

  // Step 3: Check dashboard state
  const r3 = await tab('Runtime.evaluate', {
    expression: `(function() {
      const d = document.getElementById('dashboard');
      const s = document.getElementById('checkout-status');
      return {
        dashboardClasses: d ? d.className : 'NOT FOUND',
        statusVisible: s ? (s.checkVisibility ? s.checkVisibility({ checkVisibilityCSS: true }) : 'no API') : false,
        statusText: s ? s.innerText : 'NOT FOUND'
      };
    })()`,
    returnByValue: true
  });
  console.log('3. Dashboard state:', JSON.stringify(r3.result.value));

  ws.close();
  chrome.kill();
  try { fs.rmSync(path.join(__dirname, '.diag2'), { recursive: true, force: true }); } catch {}
  process.exit(0);
}

poll(0);
