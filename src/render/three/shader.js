// Two things in this renderer are painted onto the world by POSITION rather
// than by mesh: the fog of war, which hides ground nobody is looking at, and
// the marks a battle leaves in the ground. Neither belongs to any one object —
// a crater falls across a field, a road and a hedge alike — so neither can be
// a texture laid on a model. Both are sampled in the shader from where the
// fragment actually stands on the battlefield.
//
// That needs one thing three.js does not hand out on its own: the world
// position of a fragment, on instanced meshes as well as plain ones. This
// module injects it once per compiled shader and lets several patches share it.
//
// Everything here is presentation. None of it can reach the simulation.

/**
 * Add a patch to a material's shader, keeping any patch already on it.
 *
 * `onBeforeCompile` is a single property, so the ground — which wants both the
 * fog and the decals — would otherwise get whichever was applied last.
 */
export function onCompile(material, tag, fn) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    fn(shader, renderer);
  };
  // Compiled programs are shared between materials whose cache keys match, and
  // three works that key out from onBeforeCompile.toString() - which is the
  // same string for every patch made through here, closures being invisible to
  // toString(). Without this the ground, which wants the fog AND the marks in
  // the earth, could silently be handed a hedge's fog-only program. The tags
  // are what tell them apart.
  const keys = (material.userData.shaderKeys = material.userData.shaderKeys || []);
  keys.push(tag);
  const key = keys.join('+');
  material.customProgramCacheKey = () => key;
  // A material that has already been drawn once has a compiled program cached
  // against it; this is what makes the renderer throw the old one away.
  material.needsUpdate = true;
}

/**
 * Make `vIfWorld` — the fragment's position on the battlefield — available in
 * the fragment shader. Safe to call more than once for the same compile.
 *
 * The world position is recomputed after `project_vertex` rather than read from
 * three's own `worldpos_vertex`, which is only defined when shadows or an
 * environment map happen to need it, and would silently vanish the day a
 * material stopped casting a shadow.
 */
export function worldPosition(shader) {
  if (shader.__ifWorld) return;
  shader.__ifWorld = true;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vIfWorld;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  vec4 ifWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    ifWorld = instanceMatrix * ifWorld;
  #endif
  vIfWorld = ( modelMatrix * ifWorld ).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec3 vIfWorld;',
  );
}
