// The sky.
//
// It was a single flat colour behind the ground — the same one the haze fades
// to — which is fine while the camera looks down at a map and wrong the moment
// it looks out along the ground, because a flat sky is the one thing you never
// see out of a window. A real one is darker overhead than at the horizon, and
// there is a bloom of light around wherever the sun is, and both of those tell
// you which way you are facing and what time of day it is before you have
// looked at anything else.
//
// One sphere drawn inside-out, one draw call, no depth test: it is always
// behind everything because it is drawn first and never writes depth. It rides
// with the camera, so it can be small enough to sit well inside the far plane
// and still be the whole sky.
import * as THREE from 'three';

const VERT = `
varying vec3 vIfSky;
void main() {
  vIfSky = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAG = `
#include <common>
// three prepends the tone-mapping and colour-space helpers to every
// ShaderMaterial itself; including them here as well is a redefinition and the
// whole program fails to link.
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
varying vec3 vIfSky;
void main() {
  vec3 d = normalize( vIfSky );
  // Most of the change happens in the first few degrees off the horizon, which
  // is where it happens in the world.
  float up = clamp( d.y, 0.0, 1.0 );
  vec3 c = mix( uHorizon, uZenith, pow( up, 0.42 ) );
  // The sun's own bloom, and the broader wash of light around it.
  float s = max( 0.0, dot( d, uSun ) );
  c += uGlow * ( pow( s, 130.0 ) * 1.6 + pow( s, 7.0 ) * 0.34 + pow( s, 1.6 ) * 0.09 );
  // Below the horizon the sky is the haze the ground runs out into, so the
  // apron does not end against a different colour from the one behind it.
  c = mix( c, uHorizon, clamp( -d.y * 5.0, 0.0, 1.0 ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildSky(scene) {
  const uniforms = {
    uZenith: { value: new THREE.Color(0x3f6fa8) },
    uHorizon: { value: new THREE.Color(0x8fa0ad) },
    uGlow: { value: new THREE.Color(0xffd9a0) },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
  };
  const geo = new THREE.SphereGeometry(3000, 24, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // first, and behind everything that follows
  scene.add(mesh);

  const H = new THREE.Color();
  const Z = new THREE.Color();

  return {
    mesh,

    /**
     * @param camera  the sky rides with it, so it is always the whole sky
     * @param haze    the colour the ground runs out into at this hour
     * @param sunPos  where the sun is standing, in world units
     * @param at      what the camera is looking at
     * @param light   0 at the dead of night, 1 at midday
     */
    update(camera, haze, sunPos, at, light) {
      mesh.position.copy(camera.position);
      H.setHex(haze);
      // Overhead the sky is the haze taken toward the deep blue it goes when
      // there is no dust between you and space; at night it goes to almost
      // nothing rather than to blue.
      Z.setRGB(
        H.r * (0.42 + 0.1 * light),
        H.g * (0.52 + 0.14 * light),
        H.b * (0.86 + 0.24 * light),
      );
      uniforms.uHorizon.value.copy(H);
      uniforms.uZenith.value.copy(Z);
      uniforms.uGlow.value.setRGB(
        0.5 * light + 0.04,
        0.36 * light + 0.03,
        0.2 * light + 0.05,
      );
      uniforms.uSun.value
        .set(sunPos.x - at[0], sunPos.y - at[1], sunPos.z - at[2])
        .normalize();
    },

    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
