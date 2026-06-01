# AegisQA — Best-in-Class LiveAction QA Automation Engine

AegisQA is a persistent, real-time visual browser automation and test-recording runner built for Google Chrome (Manifest V3) that controls web applications using the native Chrome DevTools Protocol (CDP).

It outputs explicit, machine-readable failure footprints (`report.json` + `agentRepairPacket`) allowing upstream CLI engineering agents (like Cursor, Claude Code, and Devin) to instantly diagnose and auto-repair front-end application bugs.

---

## 🚀 Key Features

- **Persistent Side Panel QA Dashboard**: Replaces transient popup layouts with Chrome's native `sidePanel` API to stream telemetry steps and display diagnostic reports.
- **Hardware-Level CDP Pointer Events**: Translates standard interactive events (clicks, typing, checkboxes, selects) into raw viewport coordinates using `DOM.getBoxModel` and dispatches native browser events (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`). Completely circumvents synthetic JS execution limits and shadow DOM barriers.
- **Hierarchical Shadow DOM & Iframe Piercing**: Incorporates deep tree-climbing scripts to search, scroll into view, focus, and interact with elements hidden inside multi-layer closed shadow roots and iframe contexts.
- **Dynamic Selector Healing**: Prioritizes robust semantic data attributes (`data-testid`, `data-cy`, `data-qa`, ARIA labels) and implements active fallback locators to score, match, and heal brittle selectors dynamically during replays.
- **Release promotion Gate Model**: Calculates and gates builds based on smoke test pass criteria, console exception boundaries, and custom outcome assertions, producing a clear `PROMOTE` or `DO_NOT_PROMOTE` outcome.
- **Companion CLI Test Runner**: Run tests programmatically via a Node CLI script (`launcher.js`) that launches Chrome, loads the extension, replays a suite, saves `report.json`, and shuts down.

---

## 📁 Repository Structure

```
C:\dev\AegisQA\
├── manifest.json       # Manifest V3 Extension Configuration
├── background.js       # Core Service Worker, SessionManager & CDP Bridge
├── recorder.js         # Capture-phase Interaction Content Interceptor
├── panel.html          # Persistent slate dark-mode UI
├── panel.css           # Glassmorphic component stylesheets
├── panel.js            # UI Dashboard Interaction Controller
├── launcher.js         # CLI Node Launcher & local WebSocket server
├── package.json        # Node CLI configurations & dependencies
├── test-app.html       # Visual testing app sandbox
└── report.json         # Standardized AI Agent diagnostic output
```

---

## 🛠️ Installation & Getting Started

### 1. Manual Chrome Extension Loading
1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Toggle **Developer mode** in the top right.
4. Click **Load unpacked** and select the folder `C:\dev\AegisQA`.
5. Pin **AegisQA** from the extensions bar.
6. Click the extension icon to slide open the side panel dashboard!

### 2. Manual Test Automation (Extension)
1. Open the sandbox app: double click `C:\dev\AegisQA\test-app.html`.
2. Click **Record Journey** in the panel.
3. Fill out the Sign In form, click **Sign In**.
4. Click **Execute Action Flow** on the dashboard.
5. In the side panel, click **Add Assertion** and choose `ASSERT_VISIBLE` for `#toast-message`.
6. Click **Stop Journey**.
7. Click **Replay Flow** and watch the test execute natively via CDP coordinates!

---

## 💻 CLI Integration & Playwright-like Run Mode

You can execute headless/headful automation suites from your terminal. AegisQA starts a WebSocket gateway, spawns Chrome, hooks up the CDP debugger, runs the workflow, writes a comprehensive diagnostic payload, and closes the browser.

### Run default Sandbox Smoke Test:
```bash
# Installs dependencies
npm install

# Runs headful (visible) mode
node launcher.js

# Runs headless (virtual CI/CD) mode
node launcher.js --headless
```

### Run Custom Scenario File:
```bash
node launcher.js --scenario ./custom-scenario.json --url https://my-app.com
```

---

## 📊 AI Agent Diagnostics Schema (`report.json`)

Upon completing or failing any test run, AegisQA generates a structured, machine-readable JSON telemetry dump. If a failure is found, it injects an `agentRepairPacket` explicitly optimized for LLM/CLI tools to self-heal the repository:

```json
{
  "$schema": "https://liveaction.qa/schemas/v1/report.schema.json",
  "testSuiteMetadata": {
    "runnerVersion": "LiveAction-CDP-2026.1",
    "executedAt": "2026-06-01T04:55:00Z",
    "summary": {
      "totalSteps": 10,
      "passed": 9,
      "failed": 1
    }
  },
  "steps": [
    {
      "stepIndex": 7,
      "type": "ASSERT_TEXT",
      "locator": {
        "primary": "#checkout-status",
        "fallbacks": ["data-testid='status'"]
      },
      "status": "FAIL",
      "error": "Assertion failed: Expected element to contain text 'Dashboard Active' but found 'Offline'",
      "evidence": {
        "screenshot": "data:image/png;base64,...",
        "domExcerpt": "<div class=\"dashboard-status\" id=\"checkout-status\">Offline</div>",
        "consoleErrors": ["[Console Error] Failed to fetch database API response"]
      }
    }
  ],
  "agentRepairPacket": {
    "failureClass": "validation_failed",
    "plainEnglishSummary": "The validation assertion failed on Step 7. The status box read 'Offline' instead of 'Dashboard Active'.",
    "reproductionSteps": [
      "1. Navigate to target URL",
      "2. Input credential keys",
      "3. Assert text content inside #checkout-status"
    ],
    "likelyRootCause": "The mock API request failed or was delayed, causing the react status variable to remain state-blocked.",
    "recommendedInspectionTargets": [
      "C:\\dev\\AegisQA\\test-app.html"
    ],
    "acceptanceCriteriaForFix": [
      "Verify that database response resolves and sets class state to 'Dashboard Active'."
    ]
  }
}
```

Give this `report.json` to Cursor or Claude, and it will immediately write the fix!
