# BACKLOG

## Selection rules

- unblockers first
- end-to-end value second
- quality/polish third
- docs/process last unless they unblock delivery

## Active Wave — Wave 1 (2026-04)

**Initiative:** Porto Phase 2 — stabilise and extend Portuguese Learning Journal.

**Rationale:** v10.3.7 FINAL is production-ready with 22 bugs fixed. The next layer is: (1) eliminate remaining legacy function calls and backward-compat aliases left over from the Phase 1 refactor, (2) close known Admin Panel UX gaps, (3) introduce high-value learning features (spaced repetition, audio, progress visibility). Starting with cleanup first keeps the codebase from drifting further before features land.

**MavP path:** Lightweight decision. Scope is clear from SESSION_DUMP and CLAUDE_CODE_SETUP docs. No external discovery needed.

**Main Agent decision:** Accept. Slice into bounded deliverables below.

### T-001 — Audit and replace remaining legacy function calls
- **Status:** dev_done
- **Priority:** high
- **Owner role:** developer
- **Depends on:** —
- **Acceptance criteria:**
  - Full-text scan of `portuguese_journal_v10_3_7_FINAL.html` for bare function calls that should use module prefixes (e.g. `getActiveApiKey()` without `OpenAI.`, direct Supabase calls bypassing `Database.*`)
  - Every found instance replaced with the correct module-prefixed call
  - `node -c` syntax validation passes
- **Verification type:** static
- **Evidence expected:** list of replaced calls in EXECUTION_LOG, clean `node -c` output
- **Next if passed:** T-002

### T-002 — Remove backward-compat aliases from Database module
- **Status:** dev_done
- **Priority:** medium
- **Owner role:** developer
- **Depends on:** T-001
- **Acceptance criteria:**
  - `deleteByTopicId` aliases removed from exercises, vocab, errors, explanations modules
  - All callers in the HTML already use canonical names (`deleteAllForTopic`) after T-001 cleanup
  - `node -c` passes
- **Verification type:** static
- **Evidence expected:** diff showing alias removal, clean syntax check
- **Next if passed:** T-003

### T-003 — Admin Panel: prompt editing UX improvements
- **Status:** planned
- **Priority:** medium
- **Owner role:** developer
- **Depends on:** T-002
- **Acceptance criteria:**
  - Inline edit for `prompt_content` field (textarea in-place, not modal)
  - Save / Cancel buttons visible during edit
  - Optimistic UI update on save; revert on error
  - `node -c` passes
- **Verification type:** runtime
- **Evidence expected:** manual test of edit flow recorded in EXECUTION_LOG
- **Next if passed:** T-004

### T-004 — Spaced repetition for vocabulary
- **Status:** planned
- **Priority:** high
- **Owner role:** developer
- **Depends on:** T-002
- **Acceptance criteria:**
  - `vocab` table extended with `next_review_at` (timestamp) and `interval_days` (integer) columns — migration SQL provided
  - New tab or section "Review" in TopicDetail showing due vocab items
  - Simple SM-2-like interval update on correct/incorrect answer
  - Database module updated with `vocab.updateReview(id, intervalDays)` method
  - `node -c` passes
- **Verification type:** runtime
- **Evidence expected:** demo of review flow in EXECUTION_LOG, migration SQL committed
- **Next if passed:** T-005

### T-005 — Audio pronunciation via Web Speech API
- **Status:** planned
- **Priority:** medium
- **Owner role:** developer
- **Depends on:** T-004
- **Acceptance criteria:**
  - Speaker icon on each `.vocab-row` triggers `speechSynthesis.speak()` with `lang: 'pt-PT'`
  - Icon on exercise question text also triggers pronunciation
  - Graceful no-op if browser does not support Web Speech API
  - `node -c` passes
- **Verification type:** runtime
- **Evidence expected:** manual test log in EXECUTION_LOG
- **Next if passed:** T-006

### T-006 — Progress chart per topic
- **Status:** planned
- **Priority:** low
- **Owner role:** developer
- **Depends on:** T-002
- **Acceptance criteria:**
  - Inline sparkline (Canvas 2D, no external lib) in TopicDetail header showing error_count trend over last 10 exercises
  - Data sourced from `Database.exercises.getAllForTopic(topicId)`
  - Chart renders correctly with < 2 data points (shows flat line or single dot)
  - `node -c` passes
- **Verification type:** runtime
- **Evidence expected:** screenshot or description in EXECUTION_LOG
- **Next if passed:** —

---

## Wave 1 — Archived

Completed slices appear here after merge.
