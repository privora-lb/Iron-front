// What the battle leaves in the ground: craters, tyre ruts and tank tracks,
// blood, crops flattened under armour, the stain of a house that burned down.
//
// None of this is invented here. The engine has always kept a single canvas the
// size of the whole battlefield and painted every one of those marks into it as
// it happened — that is what the flat map draws over the ground bake. This
// hands the very same canvas to the 3D ground as a texture, so a crater is in
// one place on the battlefield and both renderers show it there.
//
// The canvas is 2600 x 1650, which is far too much to hand the graphics card
// sixty times a second, and it does not need to be: a crater does not move once
// it is made. So the engine counts its own marks and this uploads only when the
// count has changed, and then no more often than twice a second.
import * as THREE from 'three';
import { onCompile, worldPosition } from './shader.js';

const EVERY = 0.5; // seconds between uploads at the very most

export function buildDecals(canvas, { W, H }) {
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; // rebuilding a mip chain is the expensive half

  const uniforms = {
    uDecalMap: { value: texture },
    uDecalSize: { value: new THREE.Vector2(W, H) },
  };

  let seen = -1;
  let last = -99;
  let sent = 0;

  return {
    texture,
    /** How many times the sheet has actually gone to the card. */
    uploads: () => sent,

    /**
     * Blend the marks into the ground's own colour BEFORE it is lit, so a
     * crater on a shadowed slope is a shadowed crater and a track across a
     * field at dusk goes the colour dusk makes everything else.
     */
    patch(material) {
      if (material.userData.decalled) return;
      material.userData.decalled = true;
      onCompile(material, 'if-marks', (shader) => {
        worldPosition(shader);
        shader.uniforms.uDecalMap = uniforms.uDecalMap;
        shader.uniforms.uDecalSize = uniforms.uDecalSize;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
uniform sampler2D uDecalMap;
uniform vec2 uDecalSize;`,
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
  {
    vec4 ifMark = texture2D( uDecalMap, vIfWorld.xz / uDecalSize );
    diffuseColor.rgb = mix( diffuseColor.rgb, ifMark.rgb, ifMark.a );
  }`,
          );
      });
    },

    /**
     * @param clock   the match clock, in seconds
     * @param version how many marks the engine has painted; unchanged means
     *                there is nothing new to send
     */
    sync(clock, version) {
      if (version === seen) return false;
      if (clock - last < EVERY && last > -1) return false;
      seen = version;
      last = clock;
      sent++;
      texture.needsUpdate = true;
      return true;
    },

    dispose() {
      texture.dispose();
    },
  };
}
