// Shared Claude Code session host. Owns the per-buddy `claude` subprocesses
// and routes their stream-json output to a caller-supplied emit callback.
// Used by main.js (renderer IPC) and claude-bridge-server.js (remote WS).
const { spawn } = require('child_process');
const os = require('os');

function claudeBinary() {
  return process.env.VIBEMOJI_CLAUDE_BIN || 'claude';
}

function createClaudeHost({ emit }) {
  const sessions = new Map(); // buddyId -> { proc, stdoutBuf, stderrBuf, cwd }

  function start(buddyId, opts = {}) {
    if (sessions.has(buddyId)) return { ok: true, alreadyRunning: true };
    const cwd = opts.cwd || process.env.VIBEMOJI_CLAUDE_CWD || os.homedir();
    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
    ];
    if (opts.model) args.push('--model', String(opts.model));
    if (Array.isArray(opts.allowedTools)) args.push('--allowedTools', opts.allowedTools.join(','));
    let proc;
    try {
      proc = spawn(claudeBinary(), args, {
        cwd,
        shell: os.platform() === 'win32',
        env: { ...process.env },
      });
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
    const session = { proc, stdoutBuf: '', stderrBuf: '', cwd };
    sessions.set(buddyId, session);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      session.stdoutBuf += chunk;
      let nl;
      while ((nl = session.stdoutBuf.indexOf('\n')) >= 0) {
        const line = session.stdoutBuf.slice(0, nl).trim();
        session.stdoutBuf = session.stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { evt = { type: 'raw', text: line }; }
        emit(buddyId, evt);
      }
    });
    proc.stderr.on('data', (chunk) => {
      session.stderrBuf += chunk;
      emit(buddyId, { type: 'stderr', text: String(chunk) });
    });
    proc.on('error', (err) => {
      emit(buddyId, { type: 'error', text: String(err && err.message || err) });
      sessions.delete(buddyId);
    });
    proc.on('close', (code) => {
      const stderr = (session.stderrBuf || '').trim();
      emit(buddyId, { type: 'closed', code, stderr, bin: claudeBinary(), cwd });
      sessions.delete(buddyId);
    });
    return { ok: true, cwd };
  }

  function send(buddyId, text) {
    const session = sessions.get(buddyId);
    if (!session) return { ok: false, error: 'no-session' };
    const msg = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: String(text) }] },
    };
    try {
      session.proc.stdin.write(JSON.stringify(msg) + '\n');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  function stop(buddyId) {
    const session = sessions.get(buddyId);
    if (!session) return { ok: true };
    try { session.proc.stdin.end(); } catch { /* noop */ }
    try { session.proc.kill(); } catch { /* noop */ }
    sessions.delete(buddyId);
    return { ok: true };
  }

  function list() { return Array.from(sessions.keys()); }
  function stopAll() { for (const id of Array.from(sessions.keys())) stop(id); }

  return { start, send, stop, list, stopAll };
}

module.exports = { createClaudeHost, claudeBinary };
