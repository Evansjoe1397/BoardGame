/**
 * Lobby overlay — Home / Join / Waiting screens.
 *
 * Shows on top of the board until the player is in a room and the game
 * has actually started (state_snapshot received with a non-initial state).
 *
 * Modes:
 *   - 'home'    : no URL params. Show "Enter name" + Create / Join buttons.
 *   - 'join'    : URL has ?room=X but no ?pid=. Show "Enter name" + Join.
 *   - 'waiting' : in a room, fewer than 2 players. Show room code + roster.
 *   - 'reconnecting' : socket dropped while in a room.
 *   - 'hidden'  : game is on; no overlay.
 */

import * as net from '../network/index.ts';
import type { PlayerInfo } from '../shared/protocol.ts';

const NICKNAME_KEY = 'boardgame_lastNickname';

type Mode = 'home' | 'join' | 'waiting' | 'reconnecting' | 'hidden';

let mode: Mode = 'hidden';
let overlayEl: HTMLDivElement | null = null;
let players: PlayerInfo[] = [];
let pendingRoomId: string | null = null; // for join screen
let connected = true;
let lastError: string | null = null;

export function initLobby(): void {
  overlayEl = document.createElement('div');
  overlayEl.id = 'lobby-overlay';
  overlayEl.className = 'lobby-overlay hidden';
  document.body.appendChild(overlayEl);

  // Subscribe to network signals
  net.onLobby(({ players: p }) => {
    players = p;
    // Stay on 'waiting' until the game starts (signaled by snapshot below).
    if (mode === 'home' || mode === 'join') {
      mode = 'waiting';
    } else if (mode === 'waiting') {
      // already there, just re-render
    }
    render();
  });

  net.onSnapshot(() => {
    // First snapshot after game starts → hide the overlay.
    mode = 'hidden';
    render();
  });

  net.onConnectionChange((isConnected) => {
    connected = isConnected;
    if (!isConnected && net.getIdentity() !== null) {
      mode = 'reconnecting';
      render();
    } else if (isConnected && mode === 'reconnecting') {
      // We'll go back to 'waiting' once a fresh state_snapshot or lobby update arrives.
      // For now keep showing the banner until then.
    }
  });

  net.onError((message) => {
    lastError = message;
    render();
    setTimeout(() => { lastError = null; render(); }, 4000);
  });

  // Decide initial mode from URL.
  const urlIdent = net.readUrlIdentity();
  if (urlIdent) {
    // We have both room+pid → rejoin attempt. Keep overlay hidden by default;
    // if anything goes wrong the error handler will show it.
    mode = 'hidden';
    net.tryRejoinFromUrl();
  } else {
    const url = new URL(location.href);
    const room = url.searchParams.get('room');
    if (room) {
      pendingRoomId = room;
      mode = 'join';
    } else {
      mode = 'home';
    }
  }

  render();
}

function defaultNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
}

function saveNickname(name: string): void {
  localStorage.setItem(NICKNAME_KEY, name);
}

function render(): void {
  if (!overlayEl) return;
  if (mode === 'hidden') {
    overlayEl.classList.add('hidden');
    overlayEl.innerHTML = '';
    return;
  }
  overlayEl.classList.remove('hidden');

  const errorBanner = lastError ? `<div class="lobby-error">${escapeHtml(lastError)}</div>` : '';
  let body = '';
  switch (mode) {
    case 'home':       body = renderHome(); break;
    case 'join':       body = renderJoin(); break;
    case 'waiting':    body = renderWaiting(); break;
    case 'reconnecting': body = renderReconnecting(); break;
  }

  overlayEl.innerHTML = `
    <div class="lobby-card">
      ${errorBanner}
      ${body}
    </div>
  `;

  wireHandlers();
}

function renderHome(): string {
  const nick = escapeHtml(defaultNickname());
  return `
    <h2>BoardGame</h2>
    <p class="lobby-sub">Multiplayer — enter your name and create or join a room.</p>
    <input id="lobbyNick" type="text" maxlength="32" placeholder="Your name" value="${nick}" autofocus />
    <div class="lobby-row">
      <button id="lobbyCreate" type="button">Create room</button>
    </div>
    <div class="lobby-divider">or join an existing room</div>
    <input id="lobbyRoomCode" type="text" maxlength="12" placeholder="Room code" />
    <div class="lobby-row">
      <button id="lobbyJoin" type="button">Join</button>
    </div>
  `;
}

function renderJoin(): string {
  const nick = escapeHtml(defaultNickname());
  const code = escapeHtml(pendingRoomId ?? '');
  return `
    <h2>Join room</h2>
    <p class="lobby-sub">Room code: <strong>${code}</strong></p>
    <input id="lobbyNick" type="text" maxlength="32" placeholder="Your name" value="${nick}" autofocus />
    <div class="lobby-row">
      <button id="lobbyJoinExisting" type="button">Join as ${code}</button>
    </div>
  `;
}

function renderWaiting(): string {
  const ident = net.getIdentity();
  const code = ident ? ident.roomId : '???';
  const myPid = ident?.pid ?? '';
  const list = players.map((p) => {
    const isMe = p.pid === myPid;
    const dot = p.connected ? '🟢' : '⚪';
    return `<li>${dot} ${escapeHtml(p.nickname || `(${p.playerId})`)} <span class="muted">${p.playerId}</span>${isMe ? ' <em>(you)</em>' : ''}</li>`;
  }).join('');
  const link = `${location.origin}${location.pathname}?room=${code}`;
  return `
    <h2>Waiting for opponent…</h2>
    <p class="lobby-sub">Room code: <strong>${code}</strong></p>
    <p class="lobby-sub">Share this link to invite:</p>
    <input id="lobbyShareLink" type="text" readonly value="${escapeHtml(link)}" onclick="this.select()" />
    <ul class="lobby-roster">${list}</ul>
    <p class="lobby-hint">Game starts automatically when both players are in.</p>
  `;
}

function renderReconnecting(): string {
  return `
    <h2>${connected ? 'Resyncing…' : 'Reconnecting…'}</h2>
    <p class="lobby-sub">Don't close this tab.</p>
  `;
}

function wireHandlers(): void {
  if (!overlayEl) return;

  const nickInput = overlayEl.querySelector<HTMLInputElement>('#lobbyNick');
  const roomCodeInput = overlayEl.querySelector<HTMLInputElement>('#lobbyRoomCode');

  overlayEl.querySelector<HTMLButtonElement>('#lobbyCreate')?.addEventListener('click', () => {
    const name = (nickInput?.value ?? '').trim().slice(0, 32) || 'Anon';
    saveNickname(name);
    net.createRoom(name);
  });

  overlayEl.querySelector<HTMLButtonElement>('#lobbyJoin')?.addEventListener('click', () => {
    const name = (nickInput?.value ?? '').trim().slice(0, 32) || 'Anon';
    const code = (roomCodeInput?.value ?? '').trim().toUpperCase();
    if (!code) return;
    saveNickname(name);
    net.joinRoom(code, name);
  });

  overlayEl.querySelector<HTMLButtonElement>('#lobbyJoinExisting')?.addEventListener('click', () => {
    const name = (nickInput?.value ?? '').trim().slice(0, 32) || 'Anon';
    if (!pendingRoomId) return;
    saveNickname(name);
    net.joinRoom(pendingRoomId, name);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
