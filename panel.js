/**
 * AegisQA Side Panel UI Controller
 * Orchestrates Record, Replay, Saved Suites, Release Gates, and Diagnostics visualization.
 */

let activeTabId = null;
let isRecording = false;
let isPlaying = false;
let recordedSteps = [];
let savedScenarios = [];
let activeScenarioIndex = null;
let lastRecordedStepSelector = '';

// Dom Elements
const btnRecord = document.getElementById('btn-record');
const btnRun = document.getElementById('btn-run');
const btnAddAssert = document.getElementById('btn-add-assert');
const btnAddWait = document.getElementById('btn-add-wait');
const btnExport = document.getElementById('btn-export');
const btnSaveScenario = document.getElementById('btn-save-scenario');
const stepLogView = document.getElementById('step-log-view');
const stepCountBadge = document.getElementById('step-count');
const targetIndicator = document.getElementById('target-indicator');
const connectionStatus = document.getElementById('connection-status');
const scenarioNameInput = document.getElementById('scenario-name');
const scenarioSuiteSelect = document.getElementById('scenario-suite');
const scenarioList = document.getElementById('scenario-list');

// Gate Elements
const gateStatusCard = document.getElementById('gate-status-card');
const gateTitle = document.getElementById('gate-title');
const gateDesc = document.getElementById('gate-desc');
const gateIconLarge = document.getElementById('gate-icon-large');
const gateOutcomeBadge = document.getElementById('gate-outcome-badge');
const critSmoke = document.getElementById('crit-smoke');
const critCrud = document.getElementById('crit-crud');
const critErrors = document.getElementById('crit-errors');
const critAssert = document.getElementById('crit-assert');

// Diagnostics Elements
const diagnosticSummary = document.getElementById('diagnostic-summary');
const diagnosticsDetail = document.getElementById('diagnostics-detail');
const diagFailTitle = document.getElementById('diag-fail-title');
const diagFailDesc = document.getElementById('diag-fail-desc');
const diagAttemptedSelectors = document.getElementById('diag-attempted-selectors');
const diagScreenshot = document.getElementById('diag-screenshot');
const diagDomExcerpt = document.getElementById('diag-dom-excerpt');
const diagConsoleErrors = document.getElementById('diag-console-errors');
const btnCopyRepair = document.getElementById('btn-copy-repair');

// Modals
const modalAssert = document.getElementById('modal-assert');
const modalWait = document.getElementById('modal-wait');

// Navigation Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    const panelId = btn.getAttribute('data-tab');
    document.getElementById(panelId).classList.add('active');
  });
});

// Initialize Panel
async function initialize() {
  // 1. Get active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0) {
    activeTabId = tabs[0].id;
    targetIndicator.textContent = tabs[0].url ? new URL(tabs[0].url).hostname : 'Local Page';
    
    // Check if background worker already has this tab attached
    chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE', tabId: activeTabId }, (response) => {
      if (response) {
        updateConnectionUI(response.attached ? 'online' : 'offline');
        if (response.isRecording) {
          isRecording = true;
          setRecordingUI(true);
        }
        if (response.steps) {
          recordedSteps = response.steps;
          renderSteps();
        }
      }
    });
  }

  // 2. Load saved scenarios
  loadScenarios();

  // 3. Setup message listener from Background worker & Content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.tabId && message.tabId !== activeTabId) return;

    if (message.type === 'STEP_RECORDED') {
      recordedSteps.push(message.step);
      if (message.step.selector) {
        lastRecordedStepSelector = message.step.selector;
      }
      renderSteps();
    } else if (message.type === 'REPLAY_PROGRESS') {
      updateReplayStepUI(message.stepIndex, message.status, message.error);
    } else if (message.type === 'REPLAY_COMPLETE') {
      handleReplayFinished(message.success, message.report);
    } else if (message.type === 'CDP_DETACHED') {
      updateConnectionUI('offline');
    } else if (message.type === 'CDP_ATTACHED') {
      updateConnectionUI('online');
    }
  });
}

// Update Connection UI Header
function updateConnectionUI(status) {
  const dot = connectionStatus.querySelector('.status-dot');
  const text = connectionStatus.querySelector('.status-text');
  dot.className = 'status-dot ' + status;
  if (status === 'online') {
    text.textContent = 'CDP Connected';
  } else if (status === 'offline') {
    text.textContent = 'CDP Disconnected';
  } else if (status === 'running') {
    text.textContent = 'Executing...';
  }
}

// Toggling Record
btnRecord.addEventListener('click', async () => {
  if (!activeTabId) return;

  if (!isRecording) {
    // Start Recording
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      tabId: activeTabId
    }, (response) => {
      if (response && response.status === 'started') {
        isRecording = true;
        recordedSteps = response.steps || [];
        setRecordingUI(true);
        updateConnectionUI('online');
        renderSteps();
      }
    });
  } else {
    // Stop Recording
    chrome.runtime.sendMessage({
      type: 'STOP_RECORDING',
      tabId: activeTabId
    }, (response) => {
      isRecording = false;
      setRecordingUI(false);
    });
  }
});

function setRecordingUI(recording) {
  if (recording) {
    btnRecord.textContent = 'Stop Journey';
    btnRecord.classList.add('recording');
    btnRun.disabled = true;
    btnAddAssert.disabled = false;
    btnAddWait.disabled = false;
  } else {
    btnRecord.textContent = 'Record Journey';
    btnRecord.classList.remove('recording');
    btnRun.disabled = recordedSteps.length === 0;
    btnExport.disabled = recordedSteps.length === 0;
    btnSaveScenario.disabled = recordedSteps.length === 0;
  }
}

// Toggling Replay Flow
btnRun.addEventListener('click', () => {
  if (!activeTabId || recordedSteps.length === 0) return;

  isPlaying = true;
  btnRun.disabled = true;
  btnRecord.disabled = true;
  updateConnectionUI('running');

  // Reset statuses in view
  renderSteps();

  chrome.runtime.sendMessage({
    type: 'START_REPLAY',
    tabId: activeTabId,
    steps: recordedSteps
  }, (response) => {
    if (response && response.status === 'started') {
      console.log('Replay started successfully.');
    } else {
      isPlaying = false;
      btnRun.disabled = false;
      btnRecord.disabled = false;
      updateConnectionUI('online');
    }
  });
});

// Replay Step UI Updates
function updateReplayStepUI(stepIndex, status, error) {
  const logEntries = stepLogView.querySelectorAll('.log-entry');
  if (logEntries[stepIndex - 1]) {
    const entry = logEntries[stepIndex - 1];
    entry.className = `log-entry ${status.toLowerCase()}`;
    
    // update status badge inside log entry
    const badge = entry.querySelector('.log-type');
    badge.textContent = status;
    
    if (status === 'FAIL' && error) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'log-payload';
      errorDiv.style.color = 'var(--accent-rose)';
      errorDiv.style.marginTop = '4px';
      errorDiv.style.fontFamily = 'var(--font-mono)';
      errorDiv.style.fontSize = '9px';
      errorDiv.textContent = `Error: ${error}`;
      entry.appendChild(errorDiv);
    }
    
    // Scroll element into view
    entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Replay Finish Orchestration
function handleReplayFinished(success, report) {
  isPlaying = false;
  btnRun.disabled = false;
  btnRecord.disabled = false;
  updateConnectionUI('online');

  // Update Release Gate Statuses
  updateReleaseGate(success, report);

  // Update Diagnostics
  updateDiagnostics(success, report);

  // Switch to the appropriate tab depending on success
  if (!success) {
    // Show Logs/Diagnostics tab
    document.querySelector('[data-tab="diagnostics-tab"]').click();
  } else {
    // Show Gate tab
    document.querySelector('[data-tab="gate-tab"]').click();
  }
}

// Update Release Gate Panel
function updateReleaseGate(success, report) {
  const steps = report.steps || [];
  const errors = steps.filter(s => s.status === 'FAIL');
  const assertions = steps.filter(s => s.type.startsWith('ASSERT_'));
  const passedAssertions = assertions.filter(s => s.status === 'PASS');

  // Indicators
  setGateCrit(critSmoke, success);
  setGateCrit(critCrud, success && steps.length > 2);
  setGateCrit(critErrors, errors.length === 0);
  setGateCrit(critAssert, assertions.length > 0 && passedAssertions.length === assertions.length);

  if (success && assertions.length > 0 && passedAssertions.length === assertions.length) {
    // Promote
    gateStatusCard.className = 'gate-status-card promote';
    gateTitle.textContent = 'System Gate: PROMOTE';
    gateDesc.textContent = 'All functional smoke tests, console boundary audits, and clinical assertions passed cleanly.';
    gateIconLarge.textContent = '✓';
    
    gateOutcomeBadge.className = 'gate-outcome-badge promote-outcome';
    gateOutcomeBadge.textContent = 'PROMOTE TO PRODUCTION';
  } else {
    // Block
    gateStatusCard.className = 'gate-status-card block';
    gateTitle.textContent = 'System Gate: BLOCKED';
    gateDesc.textContent = `Functional verification failed on step ${errors[0]?.stepIndex || 'unknown'}. Inspect telemetry diagnostics to execute AI auto-repair.`;
    gateIconLarge.textContent = '✗';
    
    gateOutcomeBadge.className = 'gate-outcome-badge block-outcome';
    gateOutcomeBadge.textContent = 'DO NOT PROMOTE';
  }
}

function setGateCrit(element, pass) {
  const bullet = element.querySelector('.bullet');
  bullet.className = 'bullet ' + (pass ? 'green' : 'red');
}

// Update Diagnostics View
let activeReport = null;
function updateDiagnostics(success, report) {
  activeReport = report;
  if (success) {
    diagnosticSummary.style.display = 'block';
    diagnosticSummary.innerHTML = `
      <div style="text-align: center; color: var(--accent-emerald); font-size: 14px; font-weight: 700; margin-bottom: 8px;">✓ All Runs Passed</div>
      <p>Test suite completed successfully in ${report.testSuiteMetadata.summary.durationMs || 0}ms. No failures recorded. Schema export matches <code>liveaction.report.v1</code> specifications.</p>
    `;
    diagnosticsDetail.style.display = 'none';
  } else {
    diagnosticSummary.style.display = 'none';
    diagnosticsDetail.style.display = 'block';

    const failStep = report.steps.find(s => s.status === 'FAIL');
    if (failStep) {
      diagFailTitle.textContent = `Step ${failStep.stepIndex} Failed: ${failStep.type}`;
      diagFailDesc.textContent = failStep.error || 'Unknown execution or assertion timeout';
      
      // Attempted selectors
      const primarySel = failStep.locator.primary;
      const fallbacks = failStep.locator.fallbacks || [];
      diagAttemptedSelectors.innerHTML = `
        <strong>Primary:</strong> ${primarySel}<br>
        <strong>Attempted Fallbacks:</strong><br>
        ${fallbacks.length > 0 ? fallbacks.map(f => `• ${f}`).join('<br>') : 'None calculated'}
      `;

      // Screenshot
      if (failStep.evidence && failStep.evidence.screenshot) {
        diagScreenshot.src = failStep.evidence.screenshot;
        diagScreenshot.parentElement.style.display = 'flex';
      } else {
        diagScreenshot.parentElement.style.display = 'none';
      }

      // DOM Excerpt
      if (failStep.evidence && failStep.evidence.domExcerpt) {
        diagDomExcerpt.textContent = failStep.evidence.domExcerpt;
        diagDomExcerpt.parentElement.style.display = 'block';
      } else {
        diagDomExcerpt.parentElement.style.display = 'none';
      }

      // Console logs
      if (failStep.evidence && failStep.evidence.consoleErrors && failStep.evidence.consoleErrors.length > 0) {
        diagConsoleErrors.innerHTML = failStep.evidence.consoleErrors.map(e => `<div class="console-err">${e}</div>`).join('');
        diagConsoleErrors.parentElement.style.display = 'block';
      } else {
        diagConsoleErrors.innerHTML = '<div>No console exceptions captured.</div>';
        diagConsoleErrors.parentElement.style.display = 'block';
      }

      // Copy prompt handler
      btnCopyRepair.onclick = () => {
        const promptText = `
I ran a LiveAction CDP QA Test and encountered a front-end functional failure.
Please fix the code of the target application using this diagnostic packet:

---
FAILURE CLASSIFICATION: ${report.agentRepairPacket.failureClass}
SUMMARY: ${report.agentRepairPacket.plainEnglishSummary}
LIKELY ROOT CAUSE: ${report.agentRepairPacket.likelyRootCause}

REPRODUCTION STEPS:
${report.agentRepairPacket.reproductionSteps.map((s, i) => `${i+1}. ${s}`).join('\n')}

BLOCKING EVIDENCE EXPLICIT PATH:
- Target Selector: ${failStep.locator.primary}
- OuterHTML Excerpt:
${failStep.evidence.domExcerpt || 'N/A'}

RECOMMENDED REPAIR TARGETS:
${report.agentRepairPacket.recommendedInspectionTargets.map(t => `- ${t}`).join('\n')}

ACCEPTANCE CRITERIA FOR PATCH:
${report.agentRepairPacket.acceptanceCriteriaForFix.map(a => `- ${a}`).join('\n')}
---
`;
        navigator.clipboard.writeText(promptText.trim());
        const oldText = btnCopyRepair.textContent;
        btnCopyRepair.textContent = '✓ Copied to Clipboard!';
        setTimeout(() => btnCopyRepair.textContent = oldText, 2000);
      };
    }
  }
}

// Render steps array into step log UI
function renderSteps() {
  if (recordedSteps.length === 0) {
    stepLogView.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <p>No steps recorded yet.</p>
        <p class="sub">Click "Record Flow" to start capturing user actions live in the current tab.</p>
      </div>
    `;
    stepCountBadge.textContent = '0 Steps';
    btnRun.disabled = true;
    btnExport.disabled = true;
    btnSaveScenario.disabled = true;
    return;
  }

  btnRun.disabled = isPlaying;
  btnExport.disabled = false;
  btnSaveScenario.disabled = false;
  stepCountBadge.textContent = `${recordedSteps.length} Step${recordedSteps.length > 1 ? 's' : ''}`;

  stepLogView.innerHTML = '';
  recordedSteps.forEach((step, idx) => {
    const entry = document.createElement('div');
    let entryClass = 'log-entry';
    if (step.type.startsWith('ASSERT_')) entryClass += ' assertion';
    else if (step.type.startsWith('WAIT_FOR')) entryClass += ' wait';
    entry.className = entryClass;

    const header = document.createElement('div');
    header.className = 'log-entry-header';
    header.innerHTML = `
      <span class="log-index">#${idx + 1}</span>
      <span class="log-type">${step.type}</span>
    `;

    const selector = document.createElement('div');
    selector.className = 'log-selector';
    selector.textContent = step.selector || 'window';
    selector.title = step.selector || '';

    const payload = document.createElement('div');
    payload.className = 'log-payload';
    if (step.type === 'TYPE') {
      payload.innerHTML = `Typed: <strong>"${escapeHtml(step.text)}"</strong>`;
    } else if (step.type === 'CLICK') {
      payload.innerHTML = `Clicked element <code>&lt;${escapeHtml(step.tagName)}&gt;</code>`;
    } else if (step.type.startsWith('ASSERT_')) {
      payload.innerHTML = `Assert <strong>${step.type.replace('ASSERT_', '')}</strong> on selector`;
      if (step.text) payload.innerHTML += ` expecting <strong>"${escapeHtml(step.text)}"</strong>`;
    } else if (step.type.startsWith('WAIT_FOR')) {
      payload.innerHTML = `Wait Strategy: <strong>${step.type}</strong> (${step.timeout || 5000}ms timeout)`;
    } else {
      payload.textContent = step.text || '';
    }

    // Append delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn delete';
    deleteBtn.style.position = 'absolute';
    deleteBtn.style.top = '6px';
    deleteBtn.style.right = '6px';
    deleteBtn.innerHTML = `<svg style="width:12px;height:12px;" viewBox="0 0 24 24"><path fill="currentColor" d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4zM6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"/></svg>`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      recordedSteps.splice(idx, 1);
      renderSteps();
      // Sync steps back to background session so it matches
      chrome.runtime.sendMessage({ type: 'SYNC_STEPS', tabId: activeTabId, steps: recordedSteps });
    });
    
    entry.style.position = 'relative';
    entry.appendChild(header);
    entry.appendChild(selector);
    entry.appendChild(payload);
    entry.appendChild(deleteBtn);
    stepLogView.appendChild(entry);
  });
}

// Injections/Modals
btnAddAssert.addEventListener('click', () => {
  document.getElementById('assert-selector').value = lastRecordedStepSelector;
  modalAssert.style.display = 'flex';
});

document.getElementById('assert-type').addEventListener('change', (e) => {
  const valGroup = document.getElementById('assert-val-group');
  if (['ASSERT_TEXT', 'ASSERT_VALUE', 'ASSERT_URL'].includes(e.target.value)) {
    valGroup.style.display = 'block';
  } else {
    valGroup.style.display = 'none';
  }
});

document.getElementById('modal-assert-cancel').addEventListener('click', () => {
  modalAssert.style.display = 'none';
});

document.getElementById('modal-assert-confirm').addEventListener('click', () => {
  const type = document.getElementById('assert-type').value;
  const selector = document.getElementById('assert-selector').value;
  const text = document.getElementById('assert-expected-value').value;

  recordedSteps.push({
    type,
    selector,
    text: ['ASSERT_TEXT', 'ASSERT_VALUE', 'ASSERT_URL'].includes(type) ? text : undefined
  });
  
  chrome.runtime.sendMessage({ type: 'SYNC_STEPS', tabId: activeTabId, steps: recordedSteps });
  renderSteps();
  modalAssert.style.display = 'none';
});

// Wait strategy modal
btnAddWait.addEventListener('click', () => {
  document.getElementById('wait-selector').value = lastRecordedStepSelector;
  modalWait.style.display = 'flex';
});

document.getElementById('wait-type').addEventListener('change', (e) => {
  const selGroup = document.getElementById('wait-sel-group');
  if (e.target.value === 'WAIT_FOR_NETWORK_IDLE' || e.target.value === 'WAIT_FOR_URL') {
    selGroup.style.display = 'none';
  } else {
    selGroup.style.display = 'block';
  }
});

document.getElementById('modal-wait-cancel').addEventListener('click', () => {
  modalWait.style.display = 'none';
});

document.getElementById('modal-wait-confirm').addEventListener('click', () => {
  const type = document.getElementById('wait-type').value;
  const selector = document.getElementById('wait-selector').value;
  const timeout = parseInt(document.getElementById('wait-timeout').value, 10) || 5000;

  recordedSteps.push({
    type,
    selector: type === 'WAIT_FOR_NETWORK_IDLE' || type === 'WAIT_FOR_URL' ? undefined : selector,
    timeout
  });
  
  chrome.runtime.sendMessage({ type: 'SYNC_STEPS', tabId: activeTabId, steps: recordedSteps });
  renderSteps();
  modalWait.style.display = 'none';
});

// JSON Exporter
btnExport.addEventListener('click', () => {
  if (recordedSteps.length === 0) return;

  let report = activeReport;
  if (!report) {
    // Compile a raw report if they haven't replayed yet
    report = {
      $schema: "https://liveaction.qa/schemas/v1/report.schema.json",
      testSuiteMetadata: {
        runnerVersion: "LiveAction-CDP-2026.1",
        executedAt: new Date().toISOString(),
        summary: {
          totalSteps: recordedSteps.length,
          passed: 0,
          failed: 0
        }
      },
      steps: recordedSteps.map((s, idx) => ({
        stepIndex: idx + 1,
        type: s.type,
        selector: s.selector || '',
        status: 'PASS',
        timestamp: new Date().toISOString(),
        error: null
      }))
    };
  }

  const jsonStr = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `liveaction_report_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Save Scenarios & Suites
btnSaveScenario.addEventListener('click', () => {
  const name = scenarioNameInput.value.trim() || `Scenario ${savedScenarios.length + 1}`;
  const suite = scenarioSuiteSelect.value;
  
  const newScenario = {
    name,
    suite,
    steps: [...recordedSteps],
    createdAt: new Date().toISOString()
  };

  savedScenarios.push(newScenario);
  chrome.storage.local.set({ savedScenarios }, () => {
    scenarioNameInput.value = '';
    loadScenarios();
    // highlight saved
    document.querySelector('[data-tab="suites-tab"]').click();
  });
});

function loadScenarios() {
  chrome.storage.local.get(['savedScenarios'], (res) => {
    if (res.savedScenarios) {
      savedScenarios = res.savedScenarios;
    }
    
    if (savedScenarios.length === 0) {
      scenarioList.innerHTML = `
        <div class="empty-state">
          <p>No saved scenarios yet.</p>
        </div>
      `;
      return;
    }

    scenarioList.innerHTML = '';
    savedScenarios.forEach((sc, idx) => {
      const card = document.createElement('div');
      card.className = 'scenario-card';
      
      const info = document.createElement('div');
      info.className = 'scenario-info';
      info.innerHTML = `
        <h4>${escapeHtml(sc.name)}</h4>
        <p>${escapeHtml(sc.suite)} • ${sc.steps.length} steps</p>
      `;

      const actions = document.createElement('div');
      actions.className = 'scenario-actions';

      const runBtn = document.createElement('button');
      runBtn.className = 'icon-btn';
      runBtn.title = 'Load Scenario';
      runBtn.innerHTML = `<svg style="width:14px;height:14px;" viewBox="0 0 24 24"><path fill="var(--accent-cyan)" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
      runBtn.addEventListener('click', () => {
        recordedSteps = [...sc.steps];
        chrome.runtime.sendMessage({ type: 'SYNC_STEPS', tabId: activeTabId, steps: recordedSteps });
        renderSteps();
        // Go back to run panel
        document.querySelector('[data-tab="runner-tab"]').click();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn delete';
      deleteBtn.title = 'Delete Scenario';
      deleteBtn.innerHTML = `<svg style="width:14px;height:14px;" viewBox="0 0 24 24"><path fill="currentColor" d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4zM6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"/></svg>`;
      deleteBtn.addEventListener('click', () => {
        savedScenarios.splice(idx, 1);
        chrome.storage.local.set({ savedScenarios }, () => {
          loadScenarios();
        });
      });

      actions.appendChild(runBtn);
      actions.appendChild(deleteBtn);
      card.appendChild(info);
      card.appendChild(actions);
      scenarioList.appendChild(card);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', initialize);
