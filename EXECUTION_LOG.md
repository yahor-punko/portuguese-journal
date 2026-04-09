# EXECUTION_LOG

## Project

- **Name:** Portuguese Learning Journal (porto)
- **Role:** Main Agent (orchestrator)
- **Current phase:** Wave 1 — Phase 2 stabilisation and feature extension

## Working brief

Single-file HTML app (~7126 lines, v10.3.7 FINAL). Vanilla JS, 13 IIFE modules, Supabase backend, OpenAI GPT-4o-mini, deployed to GitHub Pages.

Wave 1 goal: eliminate legacy debt from Phase 1 refactor, then add high-value learning features (spaced repetition, audio, progress charts).

## Key architecture decisions

- All state lives in `portuguese_journal_v10_3_7_FINAL.html` — increment version on every change
- Database module methods auto-fetch `user_id` from topic — never insert directly to exercises/vocab/errors
- Supabase `.order()` must use comma-separated columns, not chained calls
- CSS `.vocab-ru` = English text (legacy naming, intentional, do not rename)

## Milestones completed

- 2026-04-08: v10.3.7 FINAL — 22 bugs fixed, production ready
- 2026-04-09: Mavericks operating model initialised for porto project

## Working pattern for this role

- Read PROCESS_STATE.json first (`./scripts/mavp-operator --agent`)
- Take one slice at a time from BACKLOG.md in dependency order
- Validate syntax with `node -c` before marking dev_done
- Mirror every status change across BACKLOG.md and TASK_STATUS.md
- Run validator after every artifact edit

## Process rules adopted

- Artifact-first truth: state in BACKLOG/TASK_STATUS/PROCESS_STATE, not chat
- Main Agent owns transitions; sub-agents do not approve their own work
- Never mark merged without QA evidence in TASK_STATUS
- Run `node scripts/parliamentary-validator-parser-v1.js` after each backlog/status change

## Notes

### T-001 — 2026-04-09

**Audit findings:**

| Location | Issue | Fix |
|---|---|---|
| onLogin line ~4178 | `sb.from('admins')` direct query | → `Database.admin.isAdmin(user.id)` |
| global `loadSystemPrompts` | `sb.from('system_prompts')` direct query | → `AdminPanel.loadSystemPrompts()` |
| global `loadGlobalApiKey` | `sb.from('system_settings')` direct query | → `AdminPanel.loadGlobalApiKey()` |

**Deferred (no module equivalent):**
- `loadTopicPrompts` (line ~4349) — queries `topic_prompts` via `sb` directly; Database module has no getAll for topic_prompts
- `loadExamPrompts` (line ~4364) — queries `exam_prompts` via `sb` directly
- `loadFinalExams` (line ~4380) — queries `final_exams` via `sb` directly

These three are candidates for a future Database.topicPrompts / Database.examPrompts module extension.

**Also noted (T-002 scope):**
- `deleteByTopicId` aliases called at lines ~4808-4811 with extra `currentUser.id` arg — signatures mismatch. Will clean in T-002.

**Verification:** `node -c` → OK. Version: v10.3.7 → v10.4.0.

