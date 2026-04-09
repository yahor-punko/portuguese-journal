# TASK_STATUS

## Status legend

- `planned`
- `in_progress`
- `dev_done`
- `ready_for_qa`
- `qa_in_progress`
- `qa_passed`
- `needs_fix`
- `merged`

## Active tasks

### T-001 — Audit and replace remaining legacy function calls
- **Status:** dev_done
- **Owner:** developer
- **Verification type:** static
- **Last verified by:** main_agent
- **Evidence:** `node -c` passed. 3 replacements made.
- **Notes:** Fixed: (1) onLogin admin check sb→Database.admin.isAdmin(); (2) global loadSystemPrompts→AdminPanel.loadSystemPrompts(); (3) global loadGlobalApiKey→AdminPanel.loadGlobalApiKey(). Deferred: loadTopicPrompts, loadExamPrompts, loadFinalExams — no Database module equivalents yet. Version bumped to v10.4.0.

### T-002 — Remove backward-compat aliases from Database module
- **Status:** dev_done
- **Owner:** developer
- **Verification type:** static
- **Last verified by:** main_agent
- **Evidence:** `node -c` OK. No `deleteByTopicId` matches in file.
- **Notes:** 4 callers updated to `deleteAllForTopic(topicId)` (dropped extra `currentUser.id` arg). 4 alias methods removed from exercises/vocab/errors/explanations modules. Version v10.4.1.

### T-003 — Admin Panel: prompt editing UX improvements
- **Status:** planned
- **Owner:** developer
- **Verification type:** runtime
- **Last verified by:** —
- **Evidence:** —
- **Notes:** Depends on T-002.

### T-004 — Spaced repetition for vocabulary
- **Status:** planned
- **Owner:** developer
- **Verification type:** runtime
- **Last verified by:** —
- **Evidence:** —
- **Notes:** Depends on T-002. Requires DB migration.

### T-005 — Audio pronunciation via Web Speech API
- **Status:** planned
- **Owner:** developer
- **Verification type:** runtime
- **Last verified by:** —
- **Evidence:** —
- **Notes:** Depends on T-004.

### T-006 — Progress chart per topic
- **Status:** planned
- **Owner:** developer
- **Verification type:** runtime
- **Last verified by:** —
- **Evidence:** —
- **Notes:** Depends on T-002. No external libs.

## Recently completed tasks

