#!/usr/bin/env node

/**
 * Parliamentary validator parser + comparison engine + report renderer v1.
 *
 * Scope:
 * - parse active-task records from BACKLOG.md and TASK_STATUS.md
 * - normalize them into a stable comparison-friendly shape
 * - compare normalized records across both artifacts
 * - render compact human-readable validator output by default
 * - print inspectable JSON when requested
 *
 * Intentional non-goals:
 * - no advanced CLI packaging yet
 * - no PROCESS_STATE / packet / repair automation checks yet
 *
 * Assumptions documented from the implementation docs:
 * - task blocks begin with headings like `### T-XXX — ...`
 * - fields are markdown bullets like `- **Status:** value`
 * - TASK_STATUS active records live under `## Active tasks`
 * - BACKLOG active records are taken from `## Current pilot wave`
 *   and filtered to non-`merged` statuses so the result reflects the
 *   live backlog task set rather than the full historical wave listing
 */

const fs = require('node:fs');
const path = require('node:path');

const ACTIVE_BACKLOG_STATUSES = new Set([
  'planned',
  'in_progress',
  'dev_done',
  'ready_for_qa',
  'qa_in_progress',
  'qa_passed',
  'needs_fix',
]);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizeWhitespace(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : null;
}

function getSectionContent(markdown, headingPattern, label) {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));

  if (startIndex === -1) {
    throw new Error(`Missing expected section: ${label}`);
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

function getTaskBlocks(sectionMarkdown) {
  const lines = sectionMarkdown.split(/\r?\n/);
  const headingIndexes = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (/^###\s+T-\d+\s+—\s+/.test(lines[i])) {
      headingIndexes.push(i);
    }
  }

  return headingIndexes.map((startIndex, index) => {
    const endIndex = index + 1 < headingIndexes.length ? headingIndexes[index + 1] : lines.length;
    return lines.slice(startIndex, endIndex).join('\n').trim();
  });
}

function getField(block, fieldLabel) {
  const escaped = fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.+)$`, 'm'));
  return normalizeWhitespace(match ? match[1] : null);
}

function parseTaskBlock({ block, source, sourceSection }) {
  const headingMatch = block.match(/^###\s+(T-\d+)\s+—\s+(.+)$/m);
  if (!headingMatch) {
    throw new Error(`Failed to parse task heading in ${source}:${sourceSection}`);
  }

  const [, taskId, taskTitle] = headingMatch;
  const status = getField(block, 'Status');

  if (!status) {
    throw new Error(`Missing required Status field for ${taskId} in ${source}:${sourceSection}`);
  }

  return {
    source,
    sourceSection,
    taskId,
    taskTitle: normalizeWhitespace(taskTitle),
    status,
    verificationType: getField(block, 'Verification type'),
    owner: getField(block, 'Owner role') || getField(block, 'Owner'),
    rawBlock: block,
  };
}

function parseBacklogActiveTasks(markdown) {
  const sourceSection = 'Active Wave';
  const section = getSectionContent(markdown, /^##\s+Active Wave/m, '## Active Wave');

  return getTaskBlocks(section)
    .map((block) => parseTaskBlock({ block, source: 'backlog', sourceSection }))
    .filter((record) => ACTIVE_BACKLOG_STATUSES.has(record.status));
}

function parseTaskStatusActiveTasks(markdown) {
  const sourceSection = 'Active tasks';
  const section = getSectionContent(markdown, /^##\s+Active tasks\s*$/m, '## Active tasks');

  return getTaskBlocks(section)
    .map((block) => parseTaskBlock({ block, source: 'task_status', sourceSection }));
}

function createTaskRecordIndex(records) {
  const byTaskId = new Map();

  for (const record of records) {
    if (!byTaskId.has(record.taskId)) {
      byTaskId.set(record.taskId, []);
    }

    byTaskId.get(record.taskId).push(record);
  }

  return byTaskId;
}

function getSeverityForCheck(checkName) {
  const severityByCheckName = {
    missing_in_backlog: 'failure',
    missing_in_task_status: 'failure',
    title_mismatch: 'warning',
    status_mismatch: 'failure',
    verification_type_mismatch: 'warning',
    duplicate_active_task: 'failure',
  };

  return severityByCheckName[checkName] || 'warning';
}

function createFinding({ checkName, taskId, message, repairTarget, suggestedAction, details }) {
  return {
    severity: getSeverityForCheck(checkName),
    taskId,
    checkName,
    message,
    repairTarget,
    suggestedAction,
    ...(details ? { details } : {}),
  };
}

function compareField({ findings, taskId, backlogRecord, taskStatusRecord, fieldName, checkName, message, repairTarget, suggestedAction }) {
  const backlogValue = backlogRecord[fieldName];
  const taskStatusValue = taskStatusRecord[fieldName];

  if (!backlogValue || !taskStatusValue || backlogValue === taskStatusValue) {
    return;
  }

  findings.push(
    createFinding({
      checkName,
      taskId,
      message,
      repairTarget,
      suggestedAction,
      details: {
        fieldName,
        backlogValue,
        taskStatusValue,
      },
    })
  );
}

function compareRecords({ backlogRecords, taskStatusRecords }) {
  const findings = [];
  const backlogIndex = createTaskRecordIndex(backlogRecords);
  const taskStatusIndex = createTaskRecordIndex(taskStatusRecords);
  const allTaskIds = new Set([...backlogIndex.keys(), ...taskStatusIndex.keys()]);

  for (const [source, index] of [
    ['backlog', backlogIndex],
    ['task_status', taskStatusIndex],
  ]) {
    for (const [taskId, records] of index.entries()) {
      if (records.length <= 1) {
        continue;
      }

      findings.push(
        createFinding({
          checkName: 'duplicate_active_task',
          taskId,
          message: `${source === 'backlog' ? 'BACKLOG.md' : 'TASK_STATUS.md'} contains duplicate active entries for ${taskId}.`,
          repairTarget: source === 'backlog' ? 'BACKLOG.md' : 'TASK_STATUS.md',
          suggestedAction: 'Remove or reconcile duplicate active task entries so the live task set is unambiguous.',
          details: {
            source,
            duplicateCount: records.length,
            records: records.map((record) => ({
              taskTitle: record.taskTitle,
              status: record.status,
              verificationType: record.verificationType,
              sourceSection: record.sourceSection,
            })),
          },
        })
      );
    }
  }

  for (const taskId of Array.from(allTaskIds).sort()) {
    const backlogMatches = backlogIndex.get(taskId) || [];
    const taskStatusMatches = taskStatusIndex.get(taskId) || [];
    const backlogRecord = backlogMatches[0] || null;
    const taskStatusRecord = taskStatusMatches[0] || null;

    if (!backlogRecord && taskStatusRecord) {
      findings.push(
        createFinding({
          checkName: 'missing_in_backlog',
          taskId,
          message: `${taskId} appears in TASK_STATUS.md but not in the active backlog task set.`,
          repairTarget: 'BACKLOG.md',
          suggestedAction: 'Inspect the backlog active-task list and add or retire the task so both artifacts describe the same live set.',
          details: {
            taskStatusRecord,
          },
        })
      );
      continue;
    }

    if (backlogRecord && !taskStatusRecord) {
      findings.push(
        createFinding({
          checkName: 'missing_in_task_status',
          taskId,
          message: `${taskId} appears in BACKLOG.md as active but not in TASK_STATUS.md.`,
          repairTarget: 'TASK_STATUS.md',
          suggestedAction: 'Inspect TASK_STATUS.md and add or retire the task entry so the active task ledger matches the backlog.',
          details: {
            backlogRecord,
          },
        })
      );
      continue;
    }

    compareField({
      findings,
      taskId,
      backlogRecord,
      taskStatusRecord,
      fieldName: 'taskTitle',
      checkName: 'title_mismatch',
      message: `BACKLOG.md and TASK_STATUS.md disagree on the title for ${taskId}.`,
      repairTarget: 'BACKLOG.md',
      suggestedAction: 'Inspect both task titles and align the canonical wording across the two artifacts.',
    });

    compareField({
      findings,
      taskId,
      backlogRecord,
      taskStatusRecord,
      fieldName: 'status',
      checkName: 'status_mismatch',
      message: `BACKLOG.md and TASK_STATUS.md disagree on the active status for ${taskId}.`,
      repairTarget: 'TASK_STATUS.md',
      suggestedAction: 'Inspect both task entries and align the live task-state record first.',
    });

    compareField({
      findings,
      taskId,
      backlogRecord,
      taskStatusRecord,
      fieldName: 'verificationType',
      checkName: 'verification_type_mismatch',
      message: `BACKLOG.md and TASK_STATUS.md disagree on the verification type for ${taskId}.`,
      repairTarget: 'BACKLOG.md',
      suggestedAction: 'Inspect both entries and align the expected verification type.',
    });
  }

  const countsBySeverity = findings.reduce(
    (counts, finding) => ({
      ...counts,
      [finding.severity]: (counts[finding.severity] || 0) + 1,
    }),
    { warning: 0, failure: 0 }
  );

  let overallCandidateState = 'healthy';
  if (countsBySeverity.failure > 0) {
    overallCandidateState = 'misleading_repair_required';
  } else if (countsBySeverity.warning > 0) {
    overallCandidateState = 'usable_but_drifting';
  }

  return {
    overallCandidateState,
    findings,
    counts: {
      findings: findings.length,
      bySeverity: countsBySeverity,
    },
  };
}

function parseArtifacts({ backlogPath, taskStatusPath }) {
  const backlogMarkdown = readUtf8(backlogPath);
  const taskStatusMarkdown = readUtf8(taskStatusPath);

  const backlogRecords = parseBacklogActiveTasks(backlogMarkdown);
  const taskStatusRecords = parseTaskStatusActiveTasks(taskStatusMarkdown);
  const comparison = compareRecords({ backlogRecords, taskStatusRecords });

  return {
    inputs: {
      backlogPath,
      taskStatusPath,
    },
    records: {
      backlog: backlogRecords,
      taskStatus: taskStatusRecords,
      all: [...backlogRecords, ...taskStatusRecords],
    },
    counts: {
      backlog: backlogRecords.length,
      taskStatus: taskStatusRecords.length,
      all: backlogRecords.length + taskStatusRecords.length,
    },
    comparison,
  };
}

function getOverallResultLabel(overallCandidateState) {
  const labels = {
    healthy: 'Healthy',
    usable_but_drifting: 'Usable but drifting',
    misleading_repair_required: 'Misleading / repair required',
  };

  return labels[overallCandidateState] || overallCandidateState;
}

function getOperatorTakeaway(overallCandidateState) {
  const takeaways = {
    healthy: 'Continue safely.',
    usable_but_drifting: 'Clean up warnings soon before they accumulate into drift.',
    misleading_repair_required: 'Repair failures before extending the validator or governance stack.',
  };

  return takeaways[overallCandidateState] || 'Inspect findings and repair the active artifact set.';
}

function groupFindingsBySeverity(findings) {
  return findings.reduce(
    (groups, finding) => {
      groups[finding.severity] = groups[finding.severity] || [];
      groups[finding.severity].push(finding);
      return groups;
    },
    { failure: [], warning: [] }
  );
}

function renderFindingLines(finding) {
  return [
    `- [${finding.taskId}] ${finding.checkName}`,
    `  - Issue: ${finding.message}`,
    `  - Repair target: ${finding.repairTarget}`,
    `  - Next action: ${finding.suggestedAction}`,
  ];
}

function renderValidatorReport(parsed) {
  const { comparison, counts } = parsed;
  const grouped = groupFindingsBySeverity(comparison.findings);
  const lines = [
    '# Parliamentary Validator Report',
    '',
    `- Overall result: ${getOverallResultLabel(comparison.overallCandidateState)}`,
    `- Failures: ${comparison.counts.bySeverity.failure || 0}`,
    `- Warnings: ${comparison.counts.bySeverity.warning || 0}`,
    `- Backlog active records: ${counts.backlog}`,
    `- Task status active records: ${counts.taskStatus}`,
  ];

  if (grouped.failure.length > 0) {
    lines.push('', '## Failures');
    for (const finding of grouped.failure) {
      lines.push(...renderFindingLines(finding));
    }
  }

  if (grouped.warning.length > 0) {
    lines.push('', '## Warnings');
    for (const finding of grouped.warning) {
      lines.push(...renderFindingLines(finding));
    }
  }

  if (comparison.findings.length === 0) {
    lines.push('', '## Findings', '- No mismatches detected.');
  }

  lines.push('', '## Operator takeaway', getOperatorTakeaway(comparison.overallCandidateState));
  return `${lines.join('\n')}\n`;
}

function getExitCode(overallCandidateState) {
  if (overallCandidateState === 'misleading_repair_required') {
    return 2;
  }

  if (overallCandidateState === 'usable_but_drifting') {
    return 1;
  }

  return 0;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const backlogPath = path.join(repoRoot, 'BACKLOG.md');
  const taskStatusPath = path.join(repoRoot, 'TASK_STATUS.md');
  const parsed = parseArtifacts({ backlogPath, taskStatusPath });
  const asJson = process.argv.includes('--json');

  if (asJson) {
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
  } else {
    process.stdout.write(renderValidatorReport(parsed));
  }

  process.exitCode = getExitCode(parsed.comparison.overallCandidateState);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Validator failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIVE_BACKLOG_STATUSES,
  compareField,
  compareRecords,
  createFinding,
  createTaskRecordIndex,
  getExitCode,
  getField,
  getOperatorTakeaway,
  getOverallResultLabel,
  getSectionContent,
  getSeverityForCheck,
  getTaskBlocks,
  groupFindingsBySeverity,
  parseTaskBlock,
  parseBacklogActiveTasks,
  parseTaskStatusActiveTasks,
  parseArtifacts,
  renderFindingLines,
  renderValidatorReport,
};
