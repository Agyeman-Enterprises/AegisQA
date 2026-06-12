# AE CLAUDE.md
# Global context for all Agyeman Enterprises Claude Code (CCCLI) sessions.
# Source of truth: ae-master-context (Agyeman-Enterprises/ae-master-context)

---

## WHO YOU ARE WORKING FOR

Dr. Akua Agyeman — MD PhD MBA MPH. Founder/CEO, Agyeman Enterprises (34+ entities).
HITL only — approves specs via Alrtme. Never the courier between AIs.
Never ask her to paste files, hunt credentials, run commands, or explain context a machine should have.

---

## THE DOCTRINE (non-negotiable)

1. **Sovereign stack.** No app calls third parties directly — everything through AE Platform.
2. **Rewrite, don't plonk.** OSS is literature review. AE's implementation is the thesis.
3. **No rug pulls.** Abstract everything that could be acquired, abandoned, or geopolitically blocked.
4. **Military enforcement rule.** Anthropic builds. Google audits. DeepSeek verifies. Never Claude reviewing Claude.
5. **Methodology before tools.** PHNX DOWN. Workflow: DEEP AUDIT → PLAN (Akua approves) → BUILD IN PHASES → log out-of-scope in TBD.md.
6. **Warmup clock.** Nothing new in November. Operations only Oct-Nov. Relocate December.
7. **Cardinal Inference Stack — UNBREAKABLE.** All AI routes through `ai.agyemanenterprises.com` (LiteLLM). No direct provider calls.

---

## CARDINAL INFERENCE STACK

All AI inference → `ai.agyemanenterprises.com`. Use lowest tier that meets quality requirements.

| Tier | Models | Use for |
|------|--------|---------|
| 1 | `ollama/*` | Embeddings, classification, dev/test |
| 2 | `kimi` (moonshot-v1-8k) | OCR, chat, copy, summarization |
| 2L | `kimi-32k/128k` | Long-context tier-2 tasks |
| 3 | `deepseek-r1` | Reasoning, structured output |
| 4 | `claude-haiku-4-5-20251001` | Code review, moderate analysis |
| 5 | `claude-sonnet-4-6` | Complex reasoning, agentic loops, clinical notes |
| 6 | `claude-opus-4-6` | Critical decisions, adversarial review |
| 7 | `gemini-2.5-pro` | Quota fallback, independent audit |
| 8 | `gpt-4o` | Last resort only |

Rules: Routine tasks → Tier 1-2. Medical/PHI → Tier 4+. Agentic loops → Tier 5+. PHNX auditor → Tier 7.
`LITELLM_BASE_URL=https://ai.agyemanenterprises.com`. If unreachable → fail closed, log TBD.md, do not fall through to direct provider.

---

## PHNX — STATUS: DOWN

Job Cards suspended. Build workflow:
1. DEEP AUDIT — read entire codebase + full DB schema. No inference. No skipping.
2. PLAN — written plan, Akua approves before any code.
3. BUILD IN PHASES — each phase testable.
4. OUT OF SCOPE → surface to Akua + log TBD.md immediately.

---

## MNEME RELAY (live 2026-06-05)

Inter-CLI coordination via MNEME (https://mneme.agyemanenterprises.com, port 8091).
Auth: `Authorization: Bearer $MNEME_API_KEY` (in credentials.md).

Every session:
- Inbox: `mneme_inbox(agent="<name>")` or `GET /agents/messages?to=<name>`
- Bootstrap: `POST /bootstrap {prompt}`
- Handoffs: `mneme_message(...)` or `POST /agents/message` (types: status|blocker|handoff|question|done)
- Feed learnings: `POST /ingest {content, agent, node_type, cluster, metadata}`

Pick a stable agent name. MNEME replaces TBD.md for inter-CLI relay; TBD.md stays for parked work.

---

## AE MASTER CONTEXT

Local: `C:\dev\AEMasterContext\` | GitHub: `Agyeman-Enterprises/ae-master-context`
Multiple CLIs commit in parallel — always `git pull --rebase origin main` first. TBD.md conflicts: keep BOTH sides.

Key files: `TBD.md` (blockers/deferrals), `AE_MASTER_CONTEXT.md` (doctrine), `REPOS.md` (app registry), `CLAUDE.md` (source of truth).

**TBD.md** — append immediately for: blockers, decisions needing Akua, deferrals, open architectural questions.
Format: `| YYYY-MM-DD | App/Module | Description | Type | Context | Resolved |`
Types: `Blocker` | `Decision` | `Deferred` | `Active`. Append-only. Absolute dates only.

Session-end commit:
```
cd C:/dev/AEMasterContext && git pull --rebase origin main
git add TBD.md && git commit -m "TBD: session YYYY-MM-DD — [scope]" && git push origin main
```

---

## INFRASTRUCTURE

| Server | Role |
|--------|------|
| AURORA / AMIACODA (5.9.153.215) | AURORA = production Coolify/Docker. AMIACODA = dev Podman/Srvrsup. NO Docker on Podman side. |
| HERMES (178.104.176.230) | Mail only — Mailcow. `ssh root@178.104.176.230` |
| VAULT (u588268.your-storagebox.de:23) | Storage, mounted on hermes + amiacoda |

AMIACODA sovereign apps: AeGit, AeCloud, AEBase, MiBase, AkuaWatch, AeDomains, Akuma (Podman rootless only).

**Dual deployment mandatory.** Every app → BOTH Vercel AND Hetzner/Coolify. Env vars in THREE places: .env.local, Vercel dashboard, Coolify config. Setting only one = broken failover = violation.

**Database — NO Supabase Cloud (2026-06-03).** Self-hosted Supabase on AURORA per app (`sb-<app>.agyemanenterprises.com`). Own instance — never shared. Akua-approval required for any Cloud exception.

**AeGit backup repos.** Every app mirrors to aegit.agyemanenterprises.com. GitHub stays origin until AeGit proven.

Key services: Whisper STT, Ollama+DeepSeek-R1-32B, LiteLLM (ai.agyemanenterprises.com), LiveKit (livekit.agyemanenterprises.com), Mailcow (248 domains), Redis, Srvrsup, n8n, MinIO.

Machines: THE BEAST (primary, RTX 5070), Oh-gu-hm (second PC), Surface/MacBook (JARVIS instances), iPad/iPhone/Samsung Ultra 25 (mobile, Cloudflare Tunnel).
GCP Box 1: 34.26.207.116 — Mailcow (18 containers). SSH: `ssh -i ~/.ssh/id_ed25519_gcp akua@34.26.207.116`

---

## BROWSER AUTOMATION STACK

Invoke via `/ae-webbridge`. Escalation: PILGRIM → ae-webbridge → CLYKA.

| Tool | What | Best for |
|------|------|---------|
| PILGRIM | Playwright MCP (`C:\dev\pilgrim`) | Smoke tests, data extraction |
| ae-webbridge | CDP daemon port 8092 (`C:\dev\ae-webbridge`) | Functional tests, live-session |
| CLYKA | Computer Use agent port 4018, Supabase `jfpmrnkczwlqyrsggfpe` | Autonomous multi-step tasks |

---

## CREDENTIALS RULE

Primary: `C:\Users\Admin\.claude\credentials.md` — read this first, always.
Also check: Windows Sticky Notes (plum.sqlite, table Note, column Text), local `.env.local` files, Vercel env vars (`GET /v9/projects/{id}/env`).
Never ask Akua for keys. Missing credential → log Blocker in TBD.md, notify Alrtme, stop.

---

## POWERSHELL CONVENTIONS

- Use `pwsh` — never `powershell`
- `-NoProfile -ExecutionPolicy Bypass` on all scripts
- Full paths always. ASCII only in code files.

---

## BUILD CONVENTIONS

Preexisting issues: fix inline if in scope. Out of scope → TBD.md entry, move on. Do not widen scope silently.

AE Registry (`registry.agyemanenterprises.com`, Supabase `ldkbvdjzveindbhrlygs`) — check before writing any component from scratch.

Architecture: Go modular monolith for AE Platform. Auth: Zitadel issues tokens, Platform validates. Audit log in MiBase — every module call, non-optional.

---

## KEY REFS

| What | Where |
|------|-------|
| AE Master Context | `C:\dev\AEMasterContext` / Agyeman-Enterprises/ae-master-context |
| TBD log | ae-master-context → TBD.md |
| MiBase | mibase.agyemanenterprises.com |
| Vantage MCP | `C:\DEV\vantage`, port 3100 (MCP), 4021 (Hetzner) |
| AEGIS hooks | `~/.claude/hooks/` |
| HERMES | `ssh root@178.104.176.230` |
| VAULT | `sftp -P 23 u588268@u588268.your-storagebox.de` |
| LiveKit | wss://livekit.agyemanenterprises.com, key APILina14 |
| Aqui | aqui.agyemanenterprises.com — port 4002, pgvector 5439, backup `dciquwqfcroxmgljhvso` |
| Cerberus | `adoyseohewwsgatpmqdn` (Edge: /critic, /architect, /gate-decision) |
| NEXUS Supabase | `rzkjononziijzgrnexvg` |
| JEEVES Supabase | `tzjygaxpzrtevlnganjs` |
| AGtech | Supabase `maauhdiylqgfczloornk`, dashboard agtech-ecru.vercel.app |

---

## WHAT SUCCESS LOOKS LIKE

Akua dreams it. She drops it. You read it properly, think hard, catch what she missed. She approves (Gate 1). You build it. PHNX gates it. She signs off (Gate 2). It ships.

Her attention is the scarcest resource. Hit a wall → log TBD.md, surface clearly, propose options. Don't go silent. Don't widen scope. Don't make her the courier.
