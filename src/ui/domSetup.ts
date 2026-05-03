export let boardEl: HTMLDivElement;
export let handEl: HTMLDivElement;
export let pileAEl: HTMLDivElement;
export let pileBEl: HTMLDivElement;
export let turnStatusEl: HTMLDivElement;
export let logEl: HTMLDivElement;
export let endTurnBtn: HTMLButtonElement;
export let droneStatsLeftEl: HTMLDivElement;
export let droneStatsRightEl: HTMLDivElement;
export let centerFlashEl: HTMLDivElement;
export let overlayEl: HTMLDivElement;
export let app: HTMLDivElement;

export function initDomSetup(): void {
  app = document.querySelector('#app') as HTMLDivElement;
  app.innerHTML = `
  <div class="game-shell">
    <div class="top-bar">
      <div class="status" id="turnStatus"></div>
      <button id="endTurnBtn" class="end-turn">End Turn (Space)</button>
    </div>

    <div class="center-flash" id="centerFlash"></div>

    <div class="board-wrap">
      <div id="board3d"></div>
      <div class="process-echo-panel left" id="processEchoLeft">
        <div class="process-echo-title">Process Echo</div>
        <div class="process-echo-buttons">
          <button class="process-echo-btn" type="button">X</button>
          <button class="process-echo-btn" type="button">1</button>
          <button class="process-echo-btn" type="button">2</button>
          <button class="process-echo-btn" type="button">3</button>
        </div>
      </div>
      <div class="process-echo-panel right" id="processEchoRight">
        <div class="process-echo-title">Process Echo</div>
        <div class="process-echo-buttons">
          <button class="process-echo-btn" type="button">X</button>
          <button class="process-echo-btn" type="button">1</button>
          <button class="process-echo-btn" type="button">2</button>
          <button class="process-echo-btn" type="button">3</button>
        </div>
      </div>
      <div class="drone-stats-side left" id="droneStatsLeft"></div>
      <div class="drone-stats-side right" id="droneStatsRight"></div>
    </div>

    <div class="bottom-ui">
      <div class="pile pile-a" id="pileA"></div>
      <div class="hand" id="hand"></div>
      <div class="pile pile-b" id="pileB"></div>
    </div>

    <div class="log-wrap" id="logWrap">
      <button class="log-toggle" id="logToggle" type="button" title="Collapse / expand log">
        <span class="log-toggle-label">Log</span>
        <span class="log-toggle-chevron">▾</span>
      </button>
      <div class="log" id="log"></div>
    </div>
  </div>
`;

  boardEl = document.getElementById('board3d') as HTMLDivElement;
  handEl = document.getElementById('hand') as HTMLDivElement;
  pileAEl = document.getElementById('pileA') as HTMLDivElement;
  pileBEl = document.getElementById('pileB') as HTMLDivElement;
  turnStatusEl = document.getElementById('turnStatus') as HTMLDivElement;
  logEl = document.getElementById('log') as HTMLDivElement;
  endTurnBtn = document.getElementById('endTurnBtn') as HTMLButtonElement;
  droneStatsLeftEl = document.getElementById('droneStatsLeft') as HTMLDivElement;
  droneStatsRightEl = document.getElementById('droneStatsRight') as HTMLDivElement;
  centerFlashEl = document.getElementById('centerFlash') as HTMLDivElement;
  overlayEl = document.createElement('div') as HTMLDivElement;
  overlayEl.id = 'overlayRoot';
  app.appendChild(overlayEl);

  initLogToggle();
}

function initLogToggle(): void {
  const wrap = document.getElementById('logWrap') as HTMLDivElement | null;
  const toggle = document.getElementById('logToggle') as HTMLButtonElement | null;
  if (!wrap || !toggle) return;

  const STORAGE_KEY = 'boardgame.logCollapsed';
  const start = localStorage.getItem(STORAGE_KEY) === '1';
  if (start) wrap.classList.add('collapsed');

  toggle.addEventListener('click', () => {
    const collapsed = wrap.classList.toggle('collapsed');
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    // Resize the 3D viewport: the board-wrap row in the grid grew/shrunk.
    window.dispatchEvent(new Event('resize'));
  });
}
