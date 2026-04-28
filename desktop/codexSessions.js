// Shared Codex session host. Codex CLI's supported automation interface is
// one-shot `codex exec --json`, so a vibemoji "session" tracks availability
// per buddy while each user turn launches one exec process and streams JSONL.
const { spawn } = require('child_process');
const os = require('os');

function codexBinary() {
  return process.env.VIBEMOJI_CODEX_BIN || 'codex';
}

function createCodexHost({ emit }) {
  const sessions = new Map(); // buddyId -> { cwd, proc, stdoutBuf, stderrBuf, busy, resultEmitted }

  function start(buddyId, opts = {}) {
    if (sessions.has(buddyId)) return { ok: true, alreadyRunning: true };
    const cwd = opts.cwd || process.env.VIBEMOJI_CODEX_CWD || process.env.VIBEMOJI_CLAUDE_CWD || os.homedir();
    sessions.set(buddyId, { cwd, proc: null, stdoutBuf: '', stderrBuf: '', busy: false, resultEmitted: false });
    emit(buddyId, { type: 'system', subtype: 'init', cwd, bin: codexBinary() });
    return { ok: true, cwd };
  }

  function handleJsonEvent(buddyId, evt) {
    const method = evt && typeof evt === 'object' ? evt.method : undefined;
    const params = evt && typeof evt === 'object' ? evt.params : undefined;
    const type = evt && typeof evt === 'object' ? evt.type : undefined;
    if (method === 'item/agentMessage/delta') {
      const delta = params && typeof params.delta === 'string' ? params.delta : '';
      if (delta) emit(buddyId, { type: 'assistant_delta', delta: { type: 'text_delta', text: delta } });
      return;
    }
    if (type === 'item.completed') {
      const item = evt.item;
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text) {
        emit(buddyId, { type: 'assistant_delta', delta: { type: 'text_delta', text: item.text } });
        return;
      }
      if (item?.type === 'tool_call') {
        emit(buddyId, { type: 'tool_use', name: item.name || 'tool' });
        return;
      }
    }
    if (method === 'item/started') {
      const item = params && params.item;
      if (item?.type === 'toolCall') emit(buddyId, { type: 'tool_use', name: item.name || 'tool' });
      return;
    }
    if (method === 'turn/completed' || type === 'turn.completed') {
      emit(buddyId, { type: 'result' });
      const session = sessions.get(buddyId);
      if (session) session.resultEmitted = true;
      return;
    }
    emit(buddyId, { type: 'codex_event', event: evt });
  }

  function send(buddyId, text) {
    const session = sessions.get(buddyId);
    if (!session) return { ok: false, error: 'no-session' };
    if (session.busy) return { ok: false, error: 'busy' };

    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox', process.env.VIBEMOJI_CODEX_SANDBOX || 'workspace-write',
    ];
    const model = process.env.VIBEMOJI_CODEX_MODEL;
    if (model) args.push('--model', model);
    args.push('-');

    let proc;
    try {
      proc = spawn(codexBinary(), args, {
        cwd: session.cwd,
        shell: os.platform() === 'win32',
        env: { ...process.env },
      });
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }

    session.proc = proc;
    session.busy = true;
    session.resultEmitted = false;
    session.stdoutBuf = '';
    session.stderrBuf = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    try {
      proc.stdin.write(String(text));
      proc.stdin.end();
    } catch (err) {
      session.busy = false;
      session.proc = null;
      return { ok: false, error: String(err && err.message || err) };
    }
    proc.stdout.on('data', (chunk) => {
      session.stdoutBuf += chunk;
      let nl;
      while ((nl = session.stdoutBuf.indexOf('\n')) >= 0) {
        const line = session.stdoutBuf.slice(0, nl).trim();
        session.stdoutBuf = session.stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try { handleJsonEvent(buddyId, JSON.parse(line)); }
        catch { emit(buddyId, { type: 'raw', text: line }); }
      }
    });
    proc.stderr.on('data', (chunk) => {
      session.stderrBuf += chunk;
    });
    proc.on('error', (err) => {
      emit(buddyId, { type: 'error', text: String(err && err.message || err) });
      session.busy = false;
      session.proc = null;
    });
    proc.on('close', (code) => {
      const tail = session.stdoutBuf.trim();
      if (tail) {
        try { handleJsonEvent(buddyId, JSON.parse(tail)); }
        catch { emit(buddyId, { type: 'raw', text: tail }); }
      }
      const stderr = (session.stderrBuf || '').trim();
      if (code !== 0) emit(buddyId, { type: 'closed', code, stderr, bin: codexBinary(), cwd: session.cwd });
      else if (!session.resultEmitted) emit(buddyId, { type: 'result' });
      session.busy = false;
      session.proc = null;
      session.stdoutBuf = '';
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

module.exports = { createCodexHost, codexBinary };
