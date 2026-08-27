// The 3D battlefield.
//
// This is a SECOND renderer, not a replacement: it reads exactly the same world
// the top-down canvas reads — the same squads, the same terrain model, the same
// day/night clock — and draws nothing of its own invention. Nothing in here may
// write to the simulation, which is what keeps a match deterministic whichever
// way the player is looking at it.
//
// The camera is derived from the 2D one rather than kept beside it. The engine
// already has cam.x / cam.y / cam.s, and every pan, pinch, zoom button and
// minimap tap already moves them; this reads the world point at the centre of
// the screen and the scale out of those three numbers, so all of that input
// keeps working without a line of it being touched.
import * as THREE from 'three';
import { buildTerrain, buildWater, groundY } from './terrainMesh.js';
import { buildProps } from './props.js';
import { buildUnits } from './units.js';
import { buildParticles } from './particles.js';

const FOV = 45;
const HALF_FOV = Math.tan((FOV / 2) * (Math.PI / 180));
const PITCH = 0.86; // radians above the horizon: high enough to command, low enough to see relief

/** Does this device have what the 3D battlefield needs? */
export function canRender(canvas) {
  try {
    const gl = canvas.getContext('webgl2');
    return !!(gl && typeof gl.createShader === 'function');
  } catch {
    return false;
  }
}

export function createScene({ canvas, view }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x101218, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 8, 14000);

  const sun = new THREE.DirectionalLight(0xffe9c4, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 200;
  sc.far = 5200;
  sc.left = -1100;
  sc.right = 1100;
  sc.top = 1100;
  sc.bottom = -1100;
  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.HemisphereLight(0xbcd6ff, 0x4a4632, 0.55);
  scene.add(sky);

  let world = null; // terrain mesh, water, props — rebuilt per battlefield
  let units = buildUnits(scene);
  let dust = buildParticles(scene);
  let worldId = -1;
  let treesDown = -1;
  let ruins = -1;
  let works = -1;
  let vw = 1280;
  let vh = 720;

  function clearWorld() {
    if (!world) return;
    scene.remove(world.ground);
    world.ground.geometry.dispose();
    world.ground.material.dispose();
    scene.remove(world.water);
    world.water.geometry.dispose();
    world.water.material.dispose();
    world.props.dispose();
    world = null;
  }

  function buildWorld(v) {
    clearWorld();
    const built = buildTerrain(v.terrain, v.pal);
    scene.add(built.mesh);
    const water = buildWater(v.terrain, built.waterY);
    scene.add(water);
    const props = buildProps(scene, v.terrain, v);
    world = { ground: built.mesh, water, props };

    scene.fog = new THREE.Fog(0x8fa0ad, 1800, 7000);
    worldId = v.worldId;
    treesDown = v.treesDown;
    ruins = v.ruins;
    works = (v.walls || []).length;
  }

  /** The world point at the centre of the screen, and how far back to stand. */
  function readCamera(v) {
    const cam = v.cam;
    const fx = (vw / 2 - cam.x) / cam.s;
    const fy = (vh / 2 - cam.y) / cam.s;
    const dist = vh / (2 * cam.s * HALF_FOV);
    return { fx, fy, dist };
  }

  let camDist = 900;
  function placeCamera(v) {
    const { fx, fy, dist } = readCamera(v);
    const gy = groundY(v.terrain, fx, fy);
    const d = Math.max(120, Math.min(9000, dist));
    camDist = d;
    camera.position.set(fx, gy + Math.sin(PITCH) * d, fy - Math.cos(PITCH) * d);
    camera.lookAt(fx, gy, fy);

    // The sun rides the day/night clock the simulation already keeps, so the
    // shadows on screen agree with the hour on the top bar.
    const bearing = v.sun || 0.7;
    const light = Math.max(0.06, v.dayLight === undefined ? 1 : v.dayLight);
    sun.position.set(
      fx + Math.cos(bearing) * 1500,
      gy + 700 + 1400 * light,
      fy + Math.sin(bearing) * 1500,
    );
    sun.target.position.set(fx, gy, fy);
    sun.target.updateMatrixWorld();
    sun.intensity = 0.25 + 1.35 * light;
    sun.color.setRGB(1, 0.86 + 0.14 * light, 0.66 + 0.34 * light);
    sky.intensity = 0.22 + 0.5 * light;
    sky.color.setRGB(0.5 + 0.24 * light, 0.6 + 0.24 * light, 0.78 + 0.22 * light);
    if (scene.fog) {
      const haze = v.night ? 0x0d1420 : 0x8fa0ad;
      scene.fog.color.setHex(haze);
      renderer.setClearColor(haze, 1);
      scene.fog.near = d * 1.1;
      scene.fog.far = d * 4.2 + 2200;
    }
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const P3 = new THREE.Vector3();
  const DIR = new THREE.Vector3();

  return {
    resize(w, h, dpr) {
      vw = w;
      vh = h;
      renderer.setPixelRatio(Math.min(dpr || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },

    /**
     * Where on the battlefield is this point on the screen?
     *
     * The ground is not flat, so one plane intersection is not enough: land on
     * the flat, read the height there, and try again against a plane at that
     * height. Two passes puts it within a pace on anything but a cliff, and
     * costs nothing next to raycasting a mesh of thirty-five thousand cells.
     */
    screenToWorld(px, py, terrain) {
      ndc.set((px / vw) * 2 - 1, -(py / vh) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      let y = 0;
      for (let pass = 0; pass < 3; pass++) {
        plane.constant = -y;
        if (!ray.ray.intersectPlane(plane, hit)) break;
        const ny = groundY(terrain, hit.x, hit.z);
        if (Math.abs(ny - y) < 1.5) break;
        y = ny;
      }
      return { x: hit.x, y: hit.z };
    },

    worldToScreen(x, y, terrain) {
      P3.set(x, groundY(terrain, x, y), y);
      // Behind the camera a point still lands on screen, mirrored, so say so
      // rather than let a label appear over ground nobody is looking at.
      const behind = P3.clone().sub(camera.position).dot(camera.getWorldDirection(DIR)) <= 0;
      P3.project(camera);
      return { x: (P3.x * 0.5 + 0.5) * vw, y: (-P3.y * 0.5 + 0.5) * vh, behind };
    },

    frame(v) {
      if (!world || v.worldId !== worldId) buildWorld(v);
      // Felled woods and collapsed streets change what is standing; both are
      // counted by the simulation, so one comparison catches either.
      else if (v.treesDown !== treesDown || v.ruins !== ruins || (v.walls || []).length !== works) {
        world.props.refresh(v);
        treesDown = v.treesDown;
        ruins = v.ruins;
        works = (v.walls || []).length;
      }
      placeCamera(v);
      units.update(v, camDist);
      dust.update(v, camera);
      renderer.render(scene, camera);
    },

    dispose() {
      clearWorld();
      units.dispose();
      units = null;
      dust.dispose();
      dust = null;
      renderer.dispose();
    },
  };
}
