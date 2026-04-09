# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## What this repo is

Portuguese Learning Journal — single-file HTML app for learning European Portuguese (A1/A2).
Stack: Vanilla JS, Supabase, OpenAI GPT-4o-mini, GitHub Pages.
Current version: v10.3.7 FINAL (~7126 lines, 13 IIFE modules).

## Session start

Always begin a session by running:
```bash
./scripts/mavp-operator --agent
```

This returns a JSON summary of the current initiative, active slice, and next action.
Read `PROCESS_STATE.md` if deeper context is needed. Read `SESSION_DUMP_v10_3_7_FINAL.md` for schema and architecture details.

## Operational commands

```bash
# Session start summary
./scripts/mavp-operator --agent

# Full operator dashboard
./scripts/mavp-operator

# Validate artifact sync
node scripts/parliamentary-validator-parser-v1.js
```

Validator exit codes: `0` = healthy, `1` = drifting, `2` = repair required.

## Key conventions

- **Artifact-first truth:** state lives in BACKLOG.md, TASK_STATUS.md, PROCESS_STATE.md — not chat.
- **Version tracking:** every change must increment version in HTML comment, `APP_VERSION` constant, and `console.log` build line.
- **Syntax validation:** always run `node -c` before marking a slice dev_done.
- **Database module:** always use `Database.*` methods — never direct Supabase calls for exercises/vocab/errors (RLS requires user_id, module fetches it automatically).
- **Main Agent owns transitions:** sub-agents do not approve their own work.
- **Mirror rule:** every status change in BACKLOG.md must be mirrored in TASK_STATUS.md before the turn ends.
- **Run validator** after every BACKLOG.md or TASK_STATUS.md change.

## Critical schema warnings

| Table | Correct column | NOT |
|---|---|---|
| vocab | `added_at` | created_at |
| topic_prompts | `prompt_name`, `prompt_content` | name, content |
| exam_prompts | `unit_key` | exam_key |

CSS class `.vocab-ru` = English text. Intentional legacy naming — do NOT rename.

Supabase order: `.order('col1, col2', {})` — never chained `.order()` calls.
