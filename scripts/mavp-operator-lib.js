const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PROCESS_STATE_PATH = path.join(ROOT, 'PROCESS_STATE.md');
const PROCESS_STATE_JSON_PATH = path.join(ROOT, 'PROCESS_STATE.json');
const TASK_STATUS_PATH = path.join(ROOT, 'TASK_STATUS.md');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizeWhitespace(value) {
  return value ? value.replace(/\s+/g, ' ').trim() : '';
}

function getSection(markdown, headingLabel) {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === headingLabel.trim());

  if (startIndex === -1) {
    return '';
  }

  let endIndex = lines.length;
  const currentLevel = (headingLabel.match(/^#+/) || [''])[0].length;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s+/);
    if (match && match[1].length <= currentLevel) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join('\n').trim();
}

function getListItems(section) {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]\s+|\d+\.\s+)/.test(line))
    .map((line) => normalizeWhitespace(line.replace(/^([-*]\s+|\d+\.\s+)/, '')));
}

function getSingleParagraph(section) {
  return normalizeWhitespace(section.replace(/^[-*]\s+/gm, '').replace(/\n+/g, ' '));
}

function parseProcessState(markdown) {
  return {
    initiative: getSingleParagraph(getSection(markdown, '## Current initiative')),
    stage: getSingleParagraph(getSection(markdown, '## Current loop stage')),
    blockers: getListItems(getSection(markdown, '## Current blockers')),
    openQuestions: getListItems(getSection(markdown, '## Open questions')),
    nextHandoff: getListItems(getSection(markdown, '## Next expected handoff')),
    lastMeaningfulMovement: getListItems(getSection(markdown, '## Last meaningful movement')),
    lastUpdate: getSingleParagraph(getSection(markdown, '## Last update')),
  };
}

function parseActiveTask(markdown) {
  const activeTasksSection = getSection(markdown, '## Active tasks');
  const blocks = activeTasksSection
    .split(/\n(?=###\s+T-\d+)/)
    .map((block) => block.trim())
    .filter(Boolean);

  const first = blocks[0];
  if (!first) {
    return null;
  }

  const headingMatch = first.match(/^###\s+(T-\d+)\s+—\s+(.+)$/m);
  const statusMatch = first.match(/^- \*\*Status:\*\*\s+(.+)$/m);
  const ownerMatch = first.match(/^- \*\*Owner:\*\*\s+(.+)$/m);
  const notesMatch = first.match(/^- \*\*Notes:\*\*\s+(.+)$/m);

  return {
    id: headingMatch ? headingMatch[1] : 'unknown',
    title: headingMatch ? normalizeWhitespace(headingMatch[2]) : 'Unknown task',
    status: statusMatch ? normalizeWhitespace(statusMatch[1]) : 'unknown',
    owner: ownerMatch ? normalizeWhitespace(ownerMatch[1]) : 'unknown',
    notes: notesMatch ? normalizeWhitespace(notesMatch[1]) : '',
  };
}

function inferClassification(stage, task, initiative = '') {
  const source = `${initiative} ${stage} ${task?.title || ''} ${task?.notes || ''}`.toLowerCase();

  if (source.includes('migration')) return 'migration';
  if (source.includes('lightweight')) return 'lightweight';
  if (source.includes('mavp') || source.includes('parliamentary')) return 'MavP';
  return 'normal';
}

function tryParseJson(value) {
  const trimmed = (value || '').trim();

  if (!trimmed) {
    return { ok: true, data: [] };
  }

  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch (error) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 0 && lines.every((line) => line.startsWith('{') && line.endsWith('}'))) {
      try {
        return {
          ok: true,
          data: lines.map((line) => JSON.parse(line)),
        };
      } catch {
        // fall through
      }
    }

    return {
      ok: false,
      reason: `could not parse JSON output (${error.message})`,
      raw: trimmed,
    };
  }
}

function execJson(command, args) {
  try {
    const result = cp.spawnSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 4000,
    });

    if (result.error) {
      return { ok: false, reason: result.error.message };
    }

    if (result.status !== 0) {
      return {
        ok: false,
        reason: normalizeWhitespace(result.stderr || result.stdout || `exit ${result.status}`),
      };
    }

    const parsed = tryParseJson(result.stdout);
    if (parsed.ok) {
      return { ok: true, data: parsed.data };
    }

    return {
      ok: false,
      reason: parsed.reason,
      raw: parsed.raw,
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function getSessionData() {
  const toolResult = execJson('openclaw', ['sessions', '--json']);
  if (toolResult.ok) {
    return toolResult;
  }

  try {
    const fallback = cp.spawnSync('openclaw', ['gateway', 'call', 'sessions.list', '--params', '{}'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 4000,
    });

    if (fallback.error || fallback.status !== 0) {
      return toolResult;
    }

    const parsed = tryParseJson(fallback.stdout);
    if (parsed.ok) {
      return { ok: true, data: parsed.data };
    }

    return toolResult;
  } catch {
    return toolResult;
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.sessions)) return value.sessions;
  if (Array.isArray(value?.tasks)) return value.tasks;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function clip(value, max = 120) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function isBoilerplateRuntimeText(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;

  return (
    normalized.length < 8 ||
    /^(ok|done|yes|no|own|none|unknown)$/i.test(normalized) ||
    normalized.includes('reply to the user in a helpful way') ||
    normalized.includes('if it succeeded, share the relevant output') ||
    normalized.includes('if it failed, explain what went wrong') ||
    normalized.includes('approval required') ||
    normalized.includes('allow-once|allow-always|deny')
  );
}

function getSessionSummary(session) {
  const candidates = [
    session.currentTask,
    session.task,
    session.summary,
    session.prompt,
    session.lastEvent,
    session.lastMessage,
    session.note,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate);
    if (!normalized) continue;
    if (isBoilerplateRuntimeText(normalized)) continue;
    return clip(normalized, 100);
  }

  return '';
}

function formatIsoTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function getSessionStatusLabel(session) {
  const raw = normalizeWhitespace(
    session.status || session.state || session.phase || session.lastStatus || ''
  ).toLowerCase();
  const summary = normalizeWhitespace(
    [session.summary, session.task, session.currentTask, session.lastMessage, session.lastEvent, session.note]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();

  if (raw) {
    if (raw === 'done' || raw === 'completed' || raw === 'finished' || raw === 'success') return 'completed';
    if (raw === 'running' || raw === 'active' || raw === 'started' || raw === 'working') return 'running';
    if (raw.includes('wait') && raw.includes('approval')) return 'waiting_approval';
    if (raw.includes('wait') && raw.includes('subagent')) return 'waiting_subagent';
    if (raw.includes('block') || raw.includes('error') || raw.includes('failed')) return 'blocked';
    if (raw.includes('idle')) return 'idle_unexpected';
    return raw;
  }

  if (summary.includes('/approve') || summary.includes('approval required')) return 'waiting_approval';
  if (summary.includes('waiting on sub-agent') || summary.includes('waiting on subagent') || summary.includes('waiting for sub-agent') || summary.includes('waiting for subagent')) return 'waiting_subagent';
  if (summary.includes('blocked') || summary.includes('error') || summary.includes('failed')) return 'blocked';
  if (session.endedAt) return 'completed';
  if (session.key === 'agent:main:main') return 'running';
  return 'unknown';
}

function shortenSessionKey(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  if (normalized.startsWith('agent:main:main')) return 'main';
  const subagentMatch = normalized.match(/subagent:([a-f0-9-]+)$/i);
  if (subagentMatch) {
    return `subagent:${subagentMatch[1].slice(0, 8)}`;
  }
  return normalized;
}

function cleanupDisplayName(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  return normalized
    .replace(/^webchat:g-agent-main-main$/, 'main')
    .replace(/^webchat:g-agent-main-subagent-([a-f0-9-]+)$/i, (_, id) => `subagent:${id.slice(0, 8)}`)
    .replace(/^g-agent-main-main$/, 'main')
    .replace(/^g-agent-main-subagent-([a-f0-9-]+)$/i, (_, id) => `subagent:${id.slice(0, 8)}`);
}

function chooseSessionLabel(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate);
    if (!normalized) continue;
    if (normalized.length <= 3 && !normalized.includes(':') && normalized !== 'main') continue;
    if (/^[a-z]{1,4}$/i.test(normalized) && normalized !== 'main') continue;
    return normalized;
  }
  return 'unknown-session';
}

function getSessionLabel(session) {
  return chooseSessionLabel(
    session.label,
    cleanupDisplayName(session.displayName),
    session.sessionLabel,
    session.name,
    shortenSessionKey(session.key || session.sessionKey),
    session.id
  );
}

function getSessionRole(session) {
  const keySource = normalizeWhitespace(session.key || session.sessionKey || '').toLowerCase();
  const labelSource = normalizeWhitespace(
    [session.label, session.displayName, session.sessionLabel, session.name, session.agentId, session.kind, session.type]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();

  if (keySource.includes(':subagent:') || session.parentSessionKey || session.spawnedBy || labelSource.includes('subagent')) {
    return 'subagent';
  }

  if (session.key === 'agent:main:main' || keySource === 'agent:main:main' || /^agent:main:(telegram|discord|signal|whatsapp|slack|webchat):/.test(keySource)) {
    return 'main_agent';
  }

  if (labelSource.includes('human') || labelSource.includes('user')) return 'human';
  if (labelSource.includes('acp') || labelSource.includes('codex') || labelSource.includes('claude') || labelSource.includes('cursor')) return 'acp_session';
  return normalizeWhitespace(session.agentId || session.kind || session.type || 'agent');
}

function normalizeActorRecord(session) {
  return {
    actor_id: session.id || session.key || session.sessionKey || getSessionLabel(session),
    label: getSessionLabel(session),
    role: getSessionRole(session),
    status: getSessionStatusLabel(session),
    current_task: getSessionSummary(session),
    parent_actor_id: session.parentSessionKey || session.spawnedBy || '',
    updated_at: session.updatedAt || session.endedAt || session.startedAt || '',
    started_at: session.startedAt || '',
    expected_handoff: normalizeWhitespace(session.returnTo || session.handoffTarget || ''),
    raw: session,
  };
}

function getTaskWaitItems(taskList) {
  return taskList
    .map((task) => {
      const status = normalizeWhitespace(task.status || task.state || 'unknown');
      const rawLabel = normalizeWhitespace(task.label || task.name || task.id || 'unknown-task');
      const summary = getSessionSummary(task);
      const label = isBoilerplateRuntimeText(rawLabel) ? 'runtime-task' : clip(rawLabel, 60);

      if (!/wait|block|pending|running/i.test(status)) {
        return null;
      }

      return { label, status, summary };
    })
    .filter(Boolean);
}

function ageFrom(value) {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const deltaMs = Math.max(Date.now() - timestamp, 0);
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h${mins % 60 ? `${mins % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 ? `${hours % 24}h` : ''}`;
}

function getSeverity(waitType, status = '') {
  const source = `${waitType} ${status}`.toLowerCase();
  if (source.includes('blocked')) return 4;
  if (source.includes('approval')) return 3;
  if (source.includes('idle')) return 3;
  if (source.includes('subagent')) return 2;
  return 1;
}

function buildRecentEvents(processState, actors) {
  const events = [];

  for (const item of processState.lastMeaningfulMovement.slice(-8).reverse()) {
    events.push({
      event_type: 'workflow_movement',
      actor_label: 'workflow',
      summary: item,
      timestamp: processState.lastUpdate || '',
    });
  }

  for (const actor of actors) {
    if (actor.status === 'completed') {
      events.push({
        event_type: 'actor_completed',
        actor_label: actor.label,
        summary: actor.current_task ? `completed — ${actor.current_task}` : 'completed',
        timestamp: actor.updated_at || '',
      });
    } else if (actor.status === 'waiting_approval' || actor.status === 'waiting_subagent' || actor.status === 'blocked') {
      events.push({
        event_type: 'actor_transition',
        actor_label: actor.label,
        summary: `${actor.status}${actor.current_task ? ` — ${actor.current_task}` : ''}`,
        timestamp: actor.updated_at || '',
      });
    }
  }

  return events
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 10);
}

function readProcessStateJson() {
  try {
    if (!fs.existsSync(PROCESS_STATE_JSON_PATH)) return null;
    return JSON.parse(fs.readFileSync(PROCESS_STATE_JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function mergeProcessState(mdState, jsonState) {
  if (!jsonState) return mdState;
  return {
    ...mdState,
    initiative: jsonState.initiative || mdState.initiative,
    stage: jsonState.stage || mdState.stage,
    blockers: jsonState.blocker ? [jsonState.blocker] : mdState.blockers,
    openQuestions: jsonState.open_questions || mdState.openQuestions,
    lastUpdate: jsonState.last_updated || mdState.lastUpdate,
    _stageOwner: jsonState.stage_owner || '',
    _nextAction: jsonState.next_action || '',
    _activeSlice: jsonState.active_slice || '',
  };
}

function collectOperatorData() {
  const processState = mergeProcessState(
    parseProcessState(readUtf8(PROCESS_STATE_PATH)),
    readProcessStateJson()
  );
  const activeTask = parseActiveTask(readUtf8(TASK_STATUS_PATH));
  const classification = inferClassification(processState.stage, activeTask, processState.initiative);

  const sessionsResult = getSessionData();
  const tasksResult = execJson('openclaw', ['tasks', 'list', '--json']);

  const sessions = sessionsResult.ok ? toArray(sessionsResult.data) : [];
  const tasks = tasksResult.ok ? toArray(tasksResult.data) : [];
  const runtimeActors = sessions
    .map(normalizeActorRecord)
    .sort((a, b) => {
      const statusWeight = { running: 5, waiting_approval: 4, waiting_subagent: 3, blocked: 2, idle_unexpected: 1, completed: 0 };
      return (statusWeight[b.status] || -1) - (statusWeight[a.status] || -1) || String(b.updated_at).localeCompare(String(a.updated_at));
    });

  const workflowBlockers = processState.blockers.map((summary) => ({
    wait_type: 'blocker',
    actor_id: 'workflow',
    actor_label: 'workflow',
    summary,
    age: '',
    severity: getSeverity('blocker'),
    status: 'blocked',
  }));

  const waitStates = [
    ...workflowBlockers,
    ...runtimeActors
      .filter((actor) => ['waiting_approval', 'waiting_subagent', 'blocked', 'idle_unexpected'].includes(actor.status))
      .map((actor) => ({
        wait_type: actor.status.includes('approval') ? 'approval' : actor.status.includes('subagent') ? 'subagent' : actor.status.includes('idle') ? 'idle_watchdog' : 'blocker',
        actor_id: actor.actor_id,
        actor_label: actor.label,
        summary: actor.current_task || actor.status,
        age: ageFrom(actor.updated_at),
        severity: getSeverity(actor.status, actor.status),
        status: actor.status,
      })),
    ...getTaskWaitItems(tasks).map((task) => ({
      wait_type: /approval/i.test(task.status) ? 'approval' : /block/i.test(task.status) ? 'blocker' : 'subagent',
      actor_id: task.label,
      actor_label: task.label,
      summary: task.summary ? `${task.status} — ${task.summary}` : task.status,
      age: '',
      severity: getSeverity(task.status, task.status),
      status: task.status,
    })),
  ].sort((a, b) => b.severity - a.severity || String(b.age).localeCompare(String(a.age)));

  const recentEvents = buildRecentEvents(processState, runtimeActors);

  return {
    workflow_state: {
      initiative_title: processState.initiative,
      stage: processState.stage,
      active_task: activeTask ? `${activeTask.id} — ${activeTask.title}` : 'none',
      owner: activeTask?.owner || 'unknown',
      classification,
      next_handoff: processState.nextHandoff,
      blockers: processState.blockers,
      pending_approvals: waitStates.filter((item) => item.wait_type === 'approval').length,
      last_movement: processState.lastMeaningfulMovement[processState.lastMeaningfulMovement.length - 1] || '',
      task_status: activeTask?.status || 'unknown',
      task_notes: activeTask?.notes || '',
      last_update: processState.lastUpdate || '',
    },
    runtime_actors: runtimeActors,
    wait_states: waitStates,
    recent_events: recentEvents,
    sources: {
      sessions: sessionsResult,
      tasks: tasksResult,
    },
  };
}

function renderList(title, items, fallback = 'none') {
  const lines = [title];
  if (!items || items.length === 0) {
    lines.push(`- ${fallback}`);
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

function renderThinSnapshot(data) {
  const { workflow_state: workflow, runtime_actors: actors, wait_states: waits, recent_events: recentEvents, sources } = data;

  const activeActors = actors
    .filter((actor) => ['running', 'waiting_approval', 'waiting_subagent', 'blocked'].includes(actor.status))
    .map((actor) => {
      const parts = [`label:${actor.label}`, `role:${actor.role}`, `status:${actor.status}`];
      if (actor.parent_actor_id) parts.push(`parent:${shortenSessionKey(actor.parent_actor_id)}`);
      if (actor.current_task) parts.push(`task:${actor.current_task}`);
      if (actor.started_at) parts.push(`started:${formatIsoTime(actor.started_at)}`);
      if (actor.updated_at) parts.push(`updated:${formatIsoTime(actor.updated_at)}`);
      return parts.join(' | ');
    });

  const historicalActors = actors
    .filter((actor) => !['running', 'waiting_approval', 'waiting_subagent', 'blocked'].includes(actor.status))
    .slice(0, 6)
    .map((actor) => {
      const parts = [`label:${actor.label}`, `role:${actor.role}`, `status:${actor.status}`];
      if (actor.current_task) parts.push(`task:${actor.current_task}`);
      if (actor.updated_at) parts.push(`updated:${formatIsoTime(actor.updated_at)}`);
      return parts.join(' | ');
    });

  const waitLines = waits.map((wait) => `${wait.actor_label} — ${wait.status}${wait.age ? ` (${wait.age})` : ''}${wait.summary ? ` — ${wait.summary}` : ''}`);

  const recentLines = recentEvents.map((event) => `${event.actor_label} — ${event.summary}`);

  const parts = [
    '# MavP Operator Snapshot',
    '',
    `Initiative: ${workflow.initiative_title || 'unknown'}`,
    `Stage: ${workflow.stage || 'unknown'}`,
    `Active task: ${workflow.active_task || 'none'}`,
    `Task status: ${workflow.task_status || 'unknown'}`,
    `Owner: ${workflow.owner || 'unknown'}`,
    `Classification: ${workflow.classification}`,
    `Last update: ${workflow.last_update || 'unknown'}`,
    '',
    renderList('Next handoff', workflow.next_handoff, 'none visible'),
    '',
    renderList('Waits / blockers', waitLines, 'none'),
    '',
    renderList('Active runtime actors', activeActors, sources.sessions.ok ? 'no visible active runtime actors' : `runtime unavailable (${sources.sessions.reason})`),
    '',
    renderList('Historical / recently finished actors', historicalActors, 'none visible'),
    '',
    renderList('Recent movement', recentLines, 'none recorded'),
  ];

  if (!sources.tasks.ok) {
    parts.push('', `Tasks runtime source unavailable: ${sources.tasks.reason}`);
    if (sources.tasks.raw) {
      parts.push(`Tasks raw output preview: ${normalizeWhitespace(sources.tasks.raw).slice(0, 200)}`);
    }
  }

  if (!sources.sessions.ok) {
    parts.push('', `Sessions runtime source unavailable: ${sources.sessions.reason}`);
    if (sources.sessions.raw) {
      parts.push(`Sessions raw output preview: ${normalizeWhitespace(sources.sessions.raw).slice(0, 200)}`);
    }
  }

  return parts.join('\n');
}

module.exports = {
  ROOT,
  clip,
  collectOperatorData,
  formatIsoTime,
  normalizeWhitespace,
  renderThinSnapshot,
  shortenSessionKey,
};
