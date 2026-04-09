#!/usr/bin/env node

/**
 * mavp-operator-agent.js
 *
 * Compact JSON summary for the Main Agent to read at session start.
 * Outputs a single JSON object with current stage, active slice, status, and blockers.
 *
 * Usage: ./scripts/mavp-operator --agent
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PROCESS_STATE_JSON = path.join(ROOT, 'PROCESS_STATE.json');
const PROCESS_STATE_MD = path.join(ROOT, 'PROCESS_STATE.md');
const TASK_STATUS_MD = path.join(ROOT, 'TASK_STATUS.md');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizeWhitespace(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

function readProcessStateJson() {
  try {
    if (!fs.existsSync(PROCESS_STATE_JSON)) return null;
    return JSON.parse(readUtf8(PROCESS_STATE_JSON));
  } catch {
    return null;
  }
}

function parseProcessStateMd(markdown) {
  const lines = markdown.split(/\r?\n/);

  function getSection(heading) {
    const start = lines.findIndex((l) => l.trim() === heading.trim());
    if (start === -1) return '';
    let end = lines.length;
    const level = (heading.match(/^#+/) || [''])[0].length;
    for (let i = start + 1; i < lines.length; i += 1) {
      const m = lines[i].match(/^(#+)\s+/);
      if (m && m[1].length <= level) { end = i; break; }
    }
    return lines.slice(start + 1, end).join('\n').trim();
  }

  function listItems(section) {
    return section.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]/.test(l)).map((l) => normalizeWhitespace(l.replace(/^[-*]\s+/, '')));
  }

  return {
    initiative: normalizeWhitespace(getSection('## Current initiative')),
    stage: normalizeWhitespace(getSection('## Current loop stage')),
    blockers: listItems(getSection('## Current blockers')),
    nextHandoff: listItems(getSection('## Next expected handoff')),
    lastUpdate: normalizeWhitespace(getSection('## Last update')),
  };
}

function parseActiveTaskStatus(markdown) {
  const section = (() => {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+Active tasks/.test(l));
    if (start === -1) return '';
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start + 1, end).join('\n');
  })();

  const blocks = section.split(/\n(?=###\s+T-)/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const headingMatch = block.match(/^###\s+(T-\d+)\s+—\s+(.+)$/m);
    const statusMatch = block.match(/^- \*\*Status:\*\*\s+(.+)$/m);
    const ownerMatch = block.match(/^- \*\*Owner[^:]*:\*\*\s+(.+)$/m);
    return {
      id: headingMatch ? headingMatch[1] : 'unknown',
      title: headingMatch ? normalizeWhitespace(headingMatch[2]) : 'unknown',
      status: statusMatch ? normalizeWhitespace(statusMatch[1]) : 'unknown',
      owner: ownerMatch ? normalizeWhitespace(ownerMatch[1]) : 'unknown',
    };
  });
}

function main() {
  const json = readProcessStateJson();
  const md = parseProcessStateMd(readUtf8(PROCESS_STATE_MD));
  const activeTasks = parseActiveTaskStatus(readUtf8(TASK_STATUS_MD));

  const stage = json?.stage || md.stage || 'unknown';
  const initiative = json?.initiative || md.initiative || 'unknown';
  const blocker = json?.blocker || (md.blockers.length > 0 ? md.blockers[0] : null);
  const nextAction = json?.next_action || (md.nextHandoff.length > 0 ? md.nextHandoff[0] : null);
  const lastUpdated = json?.last_updated || md.lastUpdate || 'unknown';
  const stageOwner = json?.stage_owner || 'main_agent';

  const output = {
    initiative,
    stage,
    stage_owner: stageOwner,
    active_slices: activeTasks,
    blocker,
    next_action: nextAction,
    last_updated: lastUpdated,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`agent summary failed: ${error.message}\n`);
  process.exitCode = 1;
}
