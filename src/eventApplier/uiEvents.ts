/**
 * Coarse UI / scene refresh signals — current "redraw the world" path.
 * Will be eliminated once every state mutation emits a granular semantic
 * event whose handler updates only the affected DOM/Three.js piece.
 */

import type { EventHandler } from '../shared/events.ts';
import { addLog } from '../ui/log.ts';
import { renderUI } from '../ui/renderUI.ts';
import { syncBoardVisualState } from '../three/boardRenderer.ts';

export const uiEventHandlers = {
  LOG: ((e) => addLog(e.message)) satisfies EventHandler<'LOG'>,
  BOARD_SYNC: ((_e) => syncBoardVisualState()) satisfies EventHandler<'BOARD_SYNC'>,
  UI_REFRESH: ((_e) => renderUI()) satisfies EventHandler<'UI_REFRESH'>,
};
