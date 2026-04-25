// Callback registry pattern that survives Rolldown bundling.
// Using `export let X = () => {}` + `X = newFn` doesn't preserve live bindings
// in Rolldown's optimized output, so we route every call through a stable
// wrapper that reads the current callback from a mutable holder object.

const callbacks: {
  renderUI: () => void;
  syncBoardVisualState: () => void;
} = {
  renderUI: () => {},
  syncBoardVisualState: () => {},
};

export const renderUI = (): void => callbacks.renderUI();
export const syncBoardVisualState = (): void => callbacks.syncBoardVisualState();

export function registerRenderUI(fn: () => void): void {
  callbacks.renderUI = fn;
}

export function registerSyncBoardVisualState(fn: () => void): void {
  callbacks.syncBoardVisualState = fn;
}
