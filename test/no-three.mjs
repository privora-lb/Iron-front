// Stands in for the 3D renderer in the headless build.
//
// There is no WebGL in the harness, so the 3D battlefield can never start there
// — the engine checks for a WebGL2 context first and stays on the top-down
// canvas. Bundling three.js into the test build to prove that would add a
// megabyte to every one of the dozens of engine boots a suite run does.
export function canRender() {
  return false;
}
export function createScene() {
  throw new Error('the 3D renderer is not built into the headless bundle');
}
