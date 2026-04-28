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

function startBridgeServer({ port, host = '0.0.0.0', token }) {
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
    const claude = createClaudeHost({
      emit: (buddyId, event) => {
        if (ws.readyState !== ws.OPEN) return;
        try { ws.send(JSON.stringify({ type: 'event', buddyId, event })); } catch { /* noop */ }
      },
    });

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
        return replyAck(msg.id ?? null, { ok: true });
      }
      switch (msg.op) {
        case 'start': return replyAck(msg.id, claude.start(String(msg.buddyId), msg.opts || {}));
        case 'send':  return replyAck(msg.id, claude.send(String(msg.buddyId), String(msg.text || '')));
        case 'stop':  return replyAck(msg.id, claude.stop(String(msg.buddyId)));
        case 'list':  return replyAck(msg.id, claude.list());
        default:      return replyError(`unknown-op:${msg.op}`);
      }
    });

    ws.on('close', () => {
      claude.stopAll();
      console.log(`[vibemoji-bridge] connection from ${peer} closed; sessions stopped.`);
    });
  });

  return wss;
}

module.exports = { startBridgeServer };
