const { spawn } = require('child_process');
const os = require('os');

const AGENT_SPECS = [
  { id: 'gemini', label: 'Gemini CLI', binEnv: 'VIBEBUD_GEMINI_BIN', defaultBin: 'gemini', mode: 'arg', args: ['-p'] },
  { id: 'copilot', label: 'Copilot CLI', binEnv: 'VIBEBUD_COPILOT_BIN', defaultBin: 'copilot', mode: 'stdin', args: [] },
  { id: 'cursor', label: 'Cursor Agent', binEnv: 'VIBEBUD_CURSOR_AGENT_BIN', defaultBin: 'cursor-agent', mode: 'arg', args: ['--print'] },
  { id: 'codebuddy', label: 'CodeBuddy', binEnv: 'VIBEBUD_CODEBUDDY_BIN', defaultBin: 'codebuddy', mode: 'stdin', args: [] },
  { id: 'kiro', label: 'Kiro CLI', binEnv: 'VIBEBUD_KIRO_BIN', defaultBin: 'kiro-cli', mode: 'stdin', args: [] },
  { id: 'kimi', label: 'Kimi CLI', binEnv: 'VIBEBUD_KIMI_BIN', defaultBin: 'kimi', mode: 'stdin', args: [] },
  { id: 'opencode', label: 'opencode', binEnv: 'VIBEBUD_OPENCODE_BIN', defaultBin: 'opencode', mode: 'arg', args: ['run'] },
];

const AGENT_MAP = new Map(AGENT_SPECS.map((spec) => [spec.id, spec]));

function extraArgsEnv(id) {
  return `VIBEBUD_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ARGS`;
}

function splitArgs(value) {
  if (!value) return [];
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && !quote) { quote = ch; continue; }
    if (quote === ch) { quote = null; continue; }
    if (/\s/.test(ch) && !quote) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function agentBinary(spec) {
  return process.env[spec.binEnv] || spec.defaultBin;
}

function agentDescriptors() {
  return AGENT_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    env: spec.binEnv,
    bin: agentBinary(spec),
  }));
}

function createGenericAgentHost({ emit }) {
  const sessions = new Map();

  function start(buddyId, opts = {}) {
    if (sessions.has(buddyId)) return { ok: true, alreadyRunning: true };
    const agentId = String(opts.agent || '');
    const spec = AGENT_MAP.get(agentId);
    if (!spec) return { ok: false, error: `unknown-agent:${agentId}` };
    const cwd = opts.cwd || process.env.VIBEBUD_AGENT_CWD || process.env.VIBEBUD_CLAUDE_CWD || os.homedir();
    sessions.set(buddyId, { cwd, spec, proc: null, stdoutBuf: '', stderrBuf: '', busy: false });
    emit(buddyId, { type: 'system', subtype: 'init', agent: spec.id, cwd, bin: agentBinary(spec) });
    return { ok: true, cwd };
  }

  function send(buddyId, text) {
    const session = sessions.get(buddyId);
    if (!session) return { ok: false, error: 'no-session' };
    if (session.busy) return { ok: false, error: 'busy' };

    const { spec } = session;
    const prompt = String(text || '');
    const args = [...spec.args, ...splitArgs(process.env[extraArgsEnv(spec.id)])];
    if (spec.mode === 'arg') args.push(prompt);

    let proc;
    try {
      proc = spawn(agentBinary(spec), args, {
        cwd: session.cwd,
        shell: os.platform() === 'win32',
        env: { ...process.env },
      });
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }

    session.proc = proc;
    session.busy = true;
    session.stdoutBuf = '';
    session.stderrBuf = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    if (spec.mode === 'stdin') {
      try {
        proc.stdin.write(prompt);
        proc.stdin.end();
      } catch (err) {
        session.busy = false;
        session.proc = null;
        return { ok: false, error: String(err && err.message || err) };
      }
    }
    proc.stdout.on('data', (chunk) => {
      const textChunk = String(chunk);
      session.stdoutBuf += textChunk;
      emit(buddyId, { type: 'assistant_delta', delta: { type: 'text_delta', text: textChunk } });
    });
    proc.stderr.on('data', (chunk) => {
      session.stderrBuf += String(chunk);
    });
    proc.on('error', (err) => {
      emit(buddyId, { type: 'error', text: String(err && err.message || err), agent: spec.id });
      session.busy = false;
      session.proc = null;
    });
    proc.on('close', (code) => {
      const stderr = (session.stderrBuf || '').trim();
      if (code !== 0) emit(buddyId, { type: 'closed', code, stderr, agent: spec.id, bin: agentBinary(spec), cwd: session.cwd });
      else emit(buddyId, { type: 'result', agent: spec.id });
      session.busy = false;
      session.proc = null;
      session.stdoutBuf = '';
      session.stderrBuf = '';
    });
    return { ok: true };
  }

  function stop(buddyId) {
    const session = sessions.get(buddyId);
    if (!session) return { ok: true };
    try { session.proc?.kill(); } catch { /* noop */ }
    sessions.delete(buddyId);
    return { ok: true };
  }

  function list() { return Array.from(sessions.keys()); }
  function stopAll() { for (const id of Array.from(sessions.keys())) stop(id); }

  return { start, send, stop, list, stopAll };
}

module.exports = { createGenericAgentHost, agentDescriptors };
