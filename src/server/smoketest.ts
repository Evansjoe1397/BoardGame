/**
 * Tiny smoke test for the WebSocket protocol. Run with `bun run src/server/smoketest.ts`
 * while the server is running on localhost:3001.
 *
 * It opens two WebSocket connections, has the first one create a room, the
 * second one join, then verifies the right messages flow.
 */

const WS_URL = process.env.WS_URL ?? 'ws://localhost:3001/ws';

interface ClientHandle {
  ws: WebSocket;
  inbox: unknown[];
}

function open(name: string): Promise<ClientHandle> {
  const ws = new WebSocket(WS_URL);
  const inbox: unknown[] = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
    inbox.push(msg);
    console.log(`[${name} <-]`, msg);
  });
  ws.addEventListener('error', (e) => console.error(`[${name} error]`, e));
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ ws, inbox }));
    ws.addEventListener('error', reject);
  });
}

function send(client: ClientHandle, msg: unknown): void {
  console.log(`[-> ${msg && typeof msg === 'object' && 'type' in msg ? msg.type : '?'}]`, msg);
  client.ws.send(JSON.stringify(msg));
}

async function waitMsg(client: ClientHandle, type: string, ms = 1000): Promise<{ type: string } & Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = client.inbox.find((m): m is { type: string } & Record<string, unknown> =>
      typeof m === 'object' && m !== null && 'type' in m && (m as { type: string }).type === type
    );
    if (found) {
      client.inbox.splice(client.inbox.indexOf(found), 1);
      return found;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout waiting for ${type}`);
}

async function main() {
  console.log('--- Connecting two clients ---');
  const alice = await open('alice');
  const bob = await open('bob');

  console.log('\n--- Alice creates room ---');
  send(alice, { type: 'create_room', nickname: 'Alice' });
  const created = await waitMsg(alice, 'room_created');
  const roomId = created.roomId as string;
  const aliceP = created.pid as string;
  console.log(`  → roomId=${roomId} aliceP=${aliceP}`);

  console.log('\n--- Bob joins ---');
  send(bob, { type: 'join_room', roomId, nickname: 'Bob' });
  const joined = await waitMsg(bob, 'room_joined');
  const bobP = joined.pid as string;
  console.log(`  → bobP=${bobP}`);

  // Alice should have received a player_joined notification
  await waitMsg(alice, 'player_joined');

  console.log('\n--- Bob sends an END_TURN action (server runs the reducer) ---');
  send(bob, { type: 'action', action: { type: 'END_TURN' } });
  const events = await waitMsg(bob, 'events');
  console.log(`  → got ${(events.events as unknown[]).length} events`);
  await waitMsg(bob, 'state_snapshot');
  console.log('  → got state snapshot');
  // Alice should have received the same broadcast
  await waitMsg(alice, 'events');
  await waitMsg(alice, 'state_snapshot');
  console.log('  → both clients received the broadcast');

  console.log('\n--- Bob disconnects, then rejoins ---');
  bob.ws.close();
  // Alice should see a player_disconnected
  await waitMsg(alice, 'player_disconnected');

  const bob2 = await open('bob2');
  send(bob2, { type: 'rejoin', roomId, pid: bobP });
  const rejoined = await waitMsg(bob2, 'rejoined');
  console.log('  → rejoined as', rejoined.playerId);
  await waitMsg(alice, 'player_reconnected');

  console.log('\n--- Healthz ---');
  const health = await fetch('http://localhost:3001/healthz').then((r) => r.json());
  console.log('  →', health);

  console.log('\n✅ All assertions passed');

  alice.ws.close();
  bob2.ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
