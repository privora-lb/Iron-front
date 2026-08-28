// The fog of war, in three dimensions.
//
// The flat map draws this as a dark sheet over the screen with a hole punched
// wherever something of yours can see. That trick does not survive a camera
// that looks along the ground: a circle of vision drawn in screen space is an
// ellipse on the ground, and a wood standing in the dark would be lit anyway
// because the sheet is in front of it, not around it.
//
// So the fog is built where it belongs — on the battlefield. One small texture
// covers the whole map, black where nothing of yours is looking; every material
// in the scene samples it at the world position of the fragment being drawn and
// fades toward the haze. Ground, hedges, roofs and rivers all go dark together,
// and a hill in the fog is dark on the near slope and the far one alike.
//
// The eyes it draws are the SAME array the map draws — visionEyes, computed
// once a tick by the simulation. Nothing here decides what can be seen; it only
// says so in pixels.
import * as THREE from 'three';
import { onCompile, worldPosition } from './shader.js';

// Eighteen world units to a texel. The edges of vision are a soft gradient and
// the frontier is feathered, so there is no hard line for the resolution to
// give away, and the whole thing is 166KB to hand the card every frame.
const FOG_W = 288;
const DOT = 128;

/** The soft-edged disc that punches one unit's vision out of the dark. */
function makeDot(doc) {
  const c = doc.createElement('canvas');
  c.width = c.height = DOT;
  const g = c.getContext && c.getContext('2d');
  if (!g || !g.createRadialGradient) return c;
  const rg = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.62, 'rgba(255,255,255,.92)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, DOT, DOT);
  return c;
}

/**
 * @param {object} size  { W, H } of the battlefield in world units
 * @param {Document} doc where to get a canvas from; the headless harness
 *                       supplies its own, which is why this is not hard-wired
 */
export function buildFog({ W, H }, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const fh = Math.max(1, Math.round((FOG_W * H) / W));
  const canvas = d ? d.createElement('canvas') : null;
  if (canvas) {
    canvas.width = FOG_W;
    canvas.height = fh;
  }
  const g = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  const dot = d ? makeDot(d) : null;
  const scale = FOG_W / W;

  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture) {
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }

  const uniforms = {
    uFogMap: { value: texture },
    uFogSize: { value: new THREE.Vector2(W, H) },
    uFogColour: { value: new THREE.Color(0x0b1016) },
    uFogDepth: { value: 0 }, // 0 while nobody is fighting, so the lobby is clear
  };

  /** Every material in the scene fades toward the haze where nothing sees. */
  function patch(material) {
    if (!texture || material.userData.fogged) return;
    material.userData.fogged = true;
    onCompile(material, 'if-fog', (shader) => {
      worldPosition(shader);
      shader.uniforms.uFogMap = uniforms.uFogMap;
      shader.uniforms.uFogSize = uniforms.uFogSize;
      shader.uniforms.uFogColour = uniforms.uFogColour;
      shader.uniforms.uFogDepth = uniforms.uFogDepth;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uFogMap;
uniform vec2 uFogSize;
uniform vec3 uFogColour;
uniform float uFogDepth;`,
        )
        // After the colour is assembled and before it is tone mapped, so the
        // fog mixes in the same linear space the lighting worked in.
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
  {
    float ifFog = texture2D( uFogMap, vIfWorld.xz / uFogSize ).a * uFogDepth;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, uFogColour, ifFog );
  }`,
        );
    });
  }

  /** Walk the scene and fog anything that has been added since last time. */
  function patchScene(scene) {
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach(patch);
      else patch(m);
    });
  }

  let lit = false;
  let eyes = 0;
  return {
    texture,
    uniforms,
    patch,
    patchScene,

    /**
     * The colour unscouted ground fades toward. Taken from the sky's own haze
     * so it belongs to the hour, and then taken most of the way down toward
     * black: ground nobody has walked over should read as dark and dead, not as
     * ground that merely happens to be a long way off. The flat map makes the
     * same choice - it lays a near-black sheet, not a pale one.
     */
    setHaze(hex) {
      uniforms.uFogColour.value.setHex(hex).multiplyScalar(0.3);
    },

    /**
     * Redraw the fog for this frame. Cheap: a rectangle and one blit per unit
     * with eyes, into a canvas the size of a postage stamp.
     */
    update(v) {
      const on = v.phase === 'battle' || v.phase === 'deploy';
      uniforms.uFogDepth.value = on ? 0.8 : 0;
      if (!on || !g || !g.setTransform) {
        lit = false;
        return;
      }
      lit = true;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);

      // Your own half needs no scouting — the same rule the map plays by. The
      // frontier is feathered over a couple of hundred metres so the line
      // between known and unknown ground is a haze, not a fence.
      const blue = v.viewTeam === 'blue';
      const mid = W / 2;
      const fade = 220;
      if (g.createLinearGradient) {
        const grad = blue
          ? g.createLinearGradient(mid - fade, 0, mid + 40, 0)
          : g.createLinearGradient(mid + fade, 0, mid - 40, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        g.fillStyle = grad;
        g.fillRect(blue ? mid - fade : mid - 40, 0, fade + 40, H);
      }
      g.fillStyle = 'rgba(0,0,0,1)';
      if (blue) g.fillRect(mid + 40, 0, W - mid, H);
      else g.fillRect(0, 0, mid - 40, H);

      const look = v.eyes || [];
      eyes = (look.length / 3) | 0;
      if (dot && g.drawImage) {
        g.globalCompositeOperation = 'destination-out';
        for (let e = 0; e + 2 < look.length; e += 3) {
          const r = look[e + 2];
          g.drawImage(dot, look[e] - r, look[e + 1] - r, r * 2, r * 2);
        }
        g.globalCompositeOperation = 'source-over';
      }
      if (texture) texture.needsUpdate = true;
    },

    /** Is anything actually being hidden, and by how many pairs of eyes?
     *  Only the tests and the debug hook ask. */
    lit: () => lit,
    eyeCount: () => eyes,

    /**
     * How hidden is this spot on the battlefield, 0 to 1? Reads the fog sheet
     * back a pixel at a time, which is far too slow to do while drawing and
     * exactly what a test wants: it is the difference between "the fog code
     * ran" and "that ground is actually dark".
     */
    sample(x, y) {
      if (!g || !g.getImageData) return -1;
      const px = Math.max(0, Math.min(FOG_W - 1, Math.round((x * FOG_W) / W)));
      const py = Math.max(0, Math.min(fh - 1, Math.round((y * fh) / H)));
      try {
        const d = g.getImageData(px, py, 1, 1).data;
        return d[3] / 255;
      } catch {
        return -1;
      }
    },

    dispose() {
      if (texture) texture.dispose();
    },
  };
}
