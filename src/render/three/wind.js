// The wind, and the shadows of the clouds going over.
//
// A battlefield where nothing moves but the men is a diorama of a battlefield.
// Two things fix that more cheaply than anything else: grass and leaves that
// lean, and the light changing on the ground as cloud goes across the sun. Both
// are already in the simulation — `wind` is a bearing and a strength that
// wanders over the course of a match, and there are eight clouds drifting with
// it that the flat map has always laid shadows from — and the 3D field was
// reading neither.
//
// The sway is done in the vertex shader, so a hundred thousand blades of grass
// move for nothing: each one takes its phase from where its ROOT is on the
// battlefield, which makes the gust travel across a field as a wave instead of
// every tuft leaning at once.
import * as THREE from 'three';
import { onCompile } from './shader.js';

const CLOUDS = 8;

export function buildWind() {
  const cloud = [];
  for (let i = 0; i < CLOUDS; i++) cloud.push(new THREE.Vector4(0, 0, 1, 1));

  const uniforms = {
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindAmp: { value: 0.1 },
    uWindTime: { value: 0 },
    uCloud: { value: cloud }, // x, z, and the two radii
    uCloudA: { value: new Float32Array(CLOUDS) },
  };

  return {
    uniforms,

    /** Read the weather off the world view, once a frame. */
    update(v, seconds) {
      const w = v.wind || { a: 0.7, v: 1 };
      uniforms.uWindDir.value.set(Math.cos(w.a), Math.sin(w.a));
      uniforms.uWindAmp.value = 0.07 + 0.1 * (w.v || 1);
      // The gust travels with the strength of the wind, so a still day is a
      // slow breathing and a gale is a run of waves across the corn.
      uniforms.uWindTime.value = seconds * (0.9 + 0.75 * (w.v || 1));
      const cs = v.clouds || [];
      for (let i = 0; i < CLOUDS; i++) {
        const c = cs[i];
        if (!c) {
          uniforms.uCloudA.value[i] = 0;
          continue;
        }
        uniforms.uCloud.value[i].set(c.x, c.y, c.rx, c.ry);
        uniforms.uCloudA.value[i] = c.a;
      }
    },

    /**
     * Make this material's geometry lean with the wind.
     *
     * @param give how far it bends: grass all the way, a hedge a little, a tree
     *             crown somewhere between. A trunk does not bend at all and is
     *             not patched.
     */
    sway(material, give) {
      // The clutter and the props outlive the battlefield they were first
      // grown on, so this is asked for again every time a new one is built.
      // Patched twice, the uniforms are declared twice and the whole program
      // fails to link — which takes the 3D view down with it.
      if (material.userData.swayed) return;
      material.userData.swayed = true;
      onCompile(material, 'if-sway-' + give, (shader) => {
        shader.uniforms.uWindDir = uniforms.uWindDir;
        shader.uniforms.uWindAmp = uniforms.uWindAmp;
        shader.uniforms.uWindTime = uniforms.uWindTime;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
uniform vec2 uWindDir;
uniform float uWindAmp;
uniform float uWindTime;`,
          )
          // In OBJECT space, before the instance matrix is applied, so the sway
          // is bent by the same rotation and scale as the thing swaying: a tall
          // tuft leans further than a short one, which is what happens.
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec3 ifRoot = instanceMatrix[3].xyz;
      vec2 ifAx = normalize( instanceMatrix[0].xyz ).xz;
      vec2 ifAz = normalize( instanceMatrix[2].xyz ).xz;
    #else
      vec3 ifRoot = modelMatrix[3].xyz;
      vec2 ifAx = vec2( 1.0, 0.0 );
      vec2 ifAz = vec2( 0.0, 1.0 );
    #endif
    float ifPh = dot( ifRoot.xz, uWindDir ) * 0.011 + uWindTime;
    float ifS = sin( ifPh ) + 0.42 * sin( ifPh * 2.31 + 1.7 );
    float ifH = max( 0.0, transformed.y );
    float ifBend = ifS * uWindAmp * ${give.toFixed(3)} * ifH * ifH;
    transformed.x += dot( uWindDir, ifAx ) * ifBend;
    transformed.z += dot( uWindDir, ifAz ) * ifBend;
  }`,
          );
      });
    },

    /**
     * Lay the clouds' shadows on this material.
     *
     * Kept to the ground: it is the surface a shadow reads on, and the alternative
     * is handing eight clouds to every material in the scene for a darkening
     * nobody would see on a tuft of grass.
     */
    shadow(material) {
      if (material.userData.clouded) return;
      material.userData.clouded = true;
      onCompile(material, 'if-cloud', (shader) => {
        shader.uniforms.uCloud = uniforms.uCloud;
        shader.uniforms.uCloudA = uniforms.uCloudA;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
uniform vec4 uCloud[ ${CLOUDS} ];
uniform float uCloudA[ ${CLOUDS} ];`,
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
  {
    float ifCl = 0.0;
    for ( int i = 0; i < ${CLOUDS}; i++ ) {
      vec2 ifD = ( vIfWorld.xz - uCloud[ i ].xy ) / max( vec2( 1.0 ), uCloud[ i ].zw );
      float ifM = 1.0 - clamp( dot( ifD, ifD ), 0.0, 1.0 );
      ifCl += ifM * ifM * uCloudA[ i ];
    }
    diffuseColor.rgb *= 1.0 - clamp( ifCl, 0.0, 0.62 );
  }`,
          );
      });
    },
  };
}
