import { logEl } from './domSetup.ts';

export function addLog(message: string): void {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.textContent = message;
  logEl.prepend(row);

  while (logEl.children.length > 8) {
    logEl.removeChild(logEl.lastChild!);
  }
}

/**
 * Local UI hint — appends to the log panel without emitting a LOG event.
 * Use for "Select an enemy unit first", "Not enough energy", "Out of range",
 * etc. — feedback that's purely for the local user's input flow and must
 * NEVER cross the network to the other client.
 */
export const logHint = addLog;
