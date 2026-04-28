// WebSocket bridge that lets remote vibemoji clients (Android, web) drive a
// `claude` subprocess running on this machine. Same protocol the in-process
// IPC bridge uses, just JSON over WS instead of Electron IPC.
//
// Wire protocol (one JSON object per text frame):
//   client -> server:
//     { op: 'auth',  token }                     (must be first message)
//     { op: 'start', id, buddyId, opts? }
//     { op: 'send',  id, buddyId, text }
//     { op: 'stop',  id, buddyId }
//     { op: 'list',  id }
//   server -> client:
//     { type: 'ack',   id, result }
//     { type: 'event', buddyId, event }
//     { type: 'error', message }
//
// Each socket gets its own host: subprocesses are torn down when the socket
// closes so a dropped phone doesn't leave orphan claude processes around.
const { createClaudeHost } = require('./claudeSessions');
const { createCodexHost } = require('./codexSessions');

// onEvent is an optional callback fired for bridge-level lifecycle events
// (paired, session-start). main.js uses this to raise desktop notifications
// so the user knows when their phone connects and when sessions spin up.
function startBridgeServer({ port, host = '0.0.0.0', token, onEvent }) {
  const emit = (kind, info) => { try { onEvent?.(kind, info || {}); } catch { /* noop */ } };
  let WebSocketServer;
  try { ({ WebSocketServer } = require('ws')); }
  catch (err) {
    console.warn('[vibemoji-bridge] `ws` package not installed — bridge disabled.', err?.message);
    return null;
  }
  if (!token) {
    console.warn('[vibemoji-bridge] refusing to start without VIBEMOJI_BRIDGE_TOKEN.');
    return null;
  }

  const wss = new WebSocketServer({ host, port });
  console.log(`[vibemoji-bridge] listening on ws://${host}:${port}`);

  wss.on('connection', (ws, req) => {
    const peer = req.socket.remoteAddress;
    let authed = false;
    const hosts = {
      claude: createClaudeHost({
        emit: (buddyId, event) => {
          if (ws.readyState !== ws.OPEN) return;
          try { ws.send(JSON.stringify({ type: 'event', buddyId, event, agent: 'claude' })); } catch { /* noop */ }
        },
      }),
      codex: createCodexHost({
        emit: (buddyId, event) => {
          if (ws.readyState !== ws.OPEN) return;
          try { ws.send(JSON.stringify({ type: 'event', buddyId, event, agent: 'codex' })); } catch { /* noop */ }
        },
      }),
    };
    const hostFor = (msg) => {
      const agent = msg.agent === 'codex' || msg.opts?.agent === 'codex' ? 'codex' : 'claude';
      return { agent, host: hosts[agent] };
    };
    const replyAck = (id, result) => {
      try { ws.send(JSON.stringify({ type: 'ack', id, result })); } catch { /* noop */ }
    };
    const replyError = (message) => {
      try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* noop */ }
    };

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); }
      catch { return replyError('bad-json'); }
      if (!authed) {
        if (msg.op !== 'auth' || msg.token !== token) {
          replyError('unauthorized');
          try { ws.close(4401, 'unauthorized'); } catch { /* noop */ }
          return;
        }
        authed = true;
        emit('paired', { peer });
        return replyAck(msg.id ?? null, { ok: true });
      }
      switch (msg.op) {
        case 'start': {
          const buddyId = String(msg.buddyId);
          const { agent, host } = hostFor(msg);
          const result = host.start(buddyId, msg.opts || {});
          if (result.ok && !result.alreadyRunning) emit('session-start', { buddyId, peer, agent });
          return replyAck(msg.id, result);
        }
        case 'send': {
          const { host } = hostFor(msg);
          return replyAck(msg.id, host.send(String(msg.buddyId), String(msg.text || '')));
        }
        case 'stop': {
          const { host } = hostFor(msg);
          return replyAck(msg.id, host.stop(String(msg.buddyId)));
        }
        case 'list': {
          const { host } = hostFor(msg);
          return replyAck(msg.id, host.list());
        }
        default:      return replyError(`unknown-op:${msg.op}`);
      }
    });

    ws.on('close', () => {
      hosts.claude.stopAll();
      hosts.codex.stopAll();
      console.log(`[vibemoji-bridge] connection from ${peer} closed; sessions stopped.`);
    });
  });

  return wss;
}

module.exports = { startBridgeServer };
