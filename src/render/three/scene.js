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
import { buildTerrain, buildWater, groundY, setWaterTime } from './terrainMesh.js';
import { buildProps } from './props.js';
import { buildUnits } from './units.js';
import { buildParticles } from './particles.js';
import { buildFog } from './fog.js';
import { buildDecals } from './decals.js';
import { buildHedges } from './hedges.js';
import { buildBridges } from './bridges.js';
import { buildBase } from './base.js';
import { buildClutter } from './clutter.js';
import { buildSky } from './sky.js';
import { buildWind } from './wind.js';
import { buildLife } from './life.js';

const FOV = 45;
const HALF_FOV = Math.tan((FOV / 2) * (Math.PI / 180));
// Where the eye stands, and how far round the field it has walked. The pitch
// was nailed at 0.86 radians and there was no bearing at all, which meant every
// battle was fought from the same corner and a ridge always hid the same
// ground. Both move now, and both are clamped: flat on the horizon there is
// nothing to command from, and straight down is the map again.
const PITCH = 0.86;
const PITCH_MIN = 0.3;
const PITCH_MAX = 1.44;

/**
 * Where the eye stands to look at one point on the battlefield.
 *
 * Pulled out of the frame loop because it is the one piece of camera work with
 * a right answer that can be checked without a graphics card - and it was
 * wrong. The eye must stand SOUTH of what it is watching, at greater y, so that
 * west comes out on the left of the screen and the left sector at the top,
 * exactly as they are on the map and on the minimap. Standing north of it turns
 * the whole battlefield through half a circle; every part of the 3D view agrees
 * with every other part, so nothing looks broken, and the flanks are swapped.
 *
 * @returns [x, y, z] in scene units
 */
export function eyePosition(fx, gy, fy, dist, yaw, pitch) {
  const flat = Math.cos(pitch) * dist;
  return [fx + Math.sin(yaw) * flat, gy + Math.sin(pitch) * dist, fy + Math.cos(yaw) * flat];
}

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
  const doc = (canvas && canvas.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Light does not clip in the world, and it should not clip here. Without a
  // tone curve everything brighter than one unit came out the same flat white -
  // sand, stone, roads, a lit hillside - and all of the detail that had been
  // worked into them went with it. A filmic curve rolls the highlights off
  // instead, which is what lets midday look like midday.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 8, 14000);

  const sun = new THREE.DirectionalLight(0xffe9c4, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 200;
  // Mountains stand two and a half times as tall as they used to, and a shadow
  // box cut for flat country clipped the tops off them.
  sc.far = 7000;
  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.HemisphereLight(0xbcd6ff, 0x4a4632, 0.55);
  scene.add(sky);

  const fog = buildFog({ W: view.terrain.W, H: view.terrain.H }, doc);
  const weather = buildWind();

  let world = null; // terrain mesh, water, props — rebuilt per battlefield
  let clutter = buildClutter(scene);
  let life = buildLife(scene);
  let sky3 = buildSky(scene);
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
    if (world.apron) {
      scene.remove(world.apron);
      world.apron.geometry.dispose();
      world.apron.material.dispose();
    }
    scene.remove(world.water);
    world.water.geometry.dispose();
    world.water.material.dispose();
    world.props.dispose();
    world.hedges.dispose();
    world.bridges.dispose();
    world.base.dispose();
    if (world.decals) world.decals.dispose();
    world = null;
  }

  function buildWorld(v) {
    clearWorld();
    const built = buildTerrain(v.terrain, v.pal, v.landuse, v.map, v.split);
    scene.add(built.mesh);
    if (built.apron) scene.add(built.apron);
    const water = buildWater(v.terrain, built.waterY);
    scene.add(water);
    const props = buildProps(scene, v.terrain, v);
    const hedges = buildHedges(scene, v.terrain, v.landuse);
    const bridges = buildBridges(scene, v);
    const base = buildBase(scene, v);
    // Cloud on the ground, and a wind through everything that grows out of it.
    weather.shadow(built.mesh.material);
    for (const m of hedges.meshes) weather.sway(m.material, 0.16);
    for (const m of props.swaying()) weather.sway(m.material, 0.34);
    for (const m of clutter.meshes) weather.sway(m.material, 1);
    // The engine's own decal canvas, handed over whole. See decals.js: this is
    // the very sheet the flat map draws, not a copy of it.
    const decals = buildDecals(v.decal, { W: v.terrain.W, H: v.terrain.H });
    if (decals) decals.patch(built.mesh.material);
    world = { ground: built.mesh, apron: built.apron, water, props, hedges, bridges, base, decals };

    scene.fog = new THREE.Fog(0x000000, 1800, 7000);
    fog.patchScene(scene);
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
  let focusX = 0;
  let focusY = 0;
  let shadowBox = 0;
  let yaw = 0; // 0 looks up the battlefield the way the map does
  let pitch = PITCH;
  function placeCamera(v) {
    const { fx, fy, dist } = readCamera(v);
    focusX = fx;
    focusY = fy;
    const gy = groundY(v.terrain, fx, fy);
    const d = Math.max(120, Math.min(9000, dist));
    camDist = d;
    const eye = eyePosition(fx, gy, fy, d, yaw, pitch);
    camera.position.set(eye[0], eye[1], eye[2]);
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
    // The shadow box follows the zoom. Nailed at eleven hundred units it
    // covered a fifth of the field once the camera was pulled back, and every
    // fragment beyond it sampled the edge of the shadow map - which laid a hard
    // dark band straight across the countryside wherever the box ran out.
    const box = Math.max(700, Math.min(3400, d * 0.95));
    if (Math.abs(box - shadowBox) > 40) {
      shadowBox = box;
      sc.left = -box;
      sc.right = box;
      sc.top = box;
      sc.bottom = -box;
      sc.updateProjectionMatrix();
    }
    // Midday used to put two units of light on ground with half a unit of
    // albedo, and everything paler than a field clipped to flat white: the
    // stone, the sand, the shingle and the roads all came out as blank paper
    // with no texture in them at all, whatever the ground was doing underneath.
    // Nothing here is bright enough to blow out now.
    // Brighter than it looks: the tone curve above takes the top off, so the
    // sun has to be pushed well past one for a midday field to read as lit.
    sun.intensity = 0.3 + 2.15 * light;
    sun.color.setRGB(1, 0.86 + 0.14 * light, 0.66 + 0.34 * light);
    sky.intensity = 0.26 + 0.62 * light;
    sky.color.setRGB(0.5 + 0.24 * light, 0.6 + 0.24 * light, 0.78 + 0.22 * light);
    if (scene.fog) {
      // Outside the battlefield is BLACK.
      //
      // Asked for directly, and it is the right call: the apron, the haze and
      // the sky between them made a pale surround that the eye kept reading as
      // more country, so the map looked like a slab of scenery floating in more
      // scenery. Against black it reads as the thing you are fighting over and
      // nothing else, and the edge of the world stops being a place you wonder
      // about. The haze the ground fades into goes with it, so land running out
      // past the edge goes into the dark rather than into a grey band.
      const haze = 0x000000;
      scene.fog.color.setHex(haze);
      fog.setHaze(haze);
      renderer.setClearColor(haze, 1);
      // The sky goes with it. There is no weather to look at outside the
      // battlefield any more, and a lit dome over a black surround reads as a
      // bug rather than as a sky.
      sky3.mesh.visible = false;
      sky3.update(camera, haze, sun.position, [fx, gy, fy], light);
      // Aerial perspective, not a smear. Tied only to how far back the camera
      // stands, closing in on the field put the haze a hundred metres from the
      // lens and turned the whole battlefield milk; the floor keeps the near
      // ground clear however far in the player goes.
      scene.fog.near = Math.max(900, d * 1.1);
      // Far enough that the battlefield itself is clear, close enough that the
      // land running out past it goes into the haze rather than ending on a
      // hard line against the sky.
      scene.fog.far = Math.max(4600, d * 3.0 + 1600);
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
      clutter.update(v, focusX, focusY, camDist);
      // The river runs and the wind blows whether or not the battle is paused;
      // both are scenery, and neither is anything the simulation has heard of.
      const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
      setWaterTime(now);
      weather.update(v, now);
      fog.update(v);
      if (world.decals) world.decals.sync(v.clock || 0, v.decalV || 0);
      world.base.update(v);
      life.update(v);
      units.update(v, camDist);
      dust.update(v, camera);
      renderer.render(scene, camera);
    },

    /**
     * Walk round the field, or raise and lower the eye.
     *
     * The engine keeps the camera's position and zoom in cam.x/cam.y/cam.s, and
     * every pan, pinch and minimap tap already moves those. Bearing and pitch
     * are the two things the flat map has no notion of, so they live here.
     */
    orbit(dYaw, dPitch) {
      if (dYaw) yaw = (yaw + dYaw) % (Math.PI * 2);
      if (dPitch) pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + dPitch));
    },

    /** Square up to the field again — the view the map has. */
    level() {
      yaw = 0;
      pitch = PITCH;
    },

    /** Which way the camera is facing, so a drag across the screen moves the
     *  ground the way the player can see it moving. */
    bearing: () => yaw,
    tilt: () => pitch,

    /** What the renderer currently believes, for the tests and for anyone
     *  standing in front of a battlefield wondering why it looks wrong. */
    stats(v) {
      return {
        yaw,
        pitch,
        camDist,
        fog: fog.uniforms.uFogDepth.value,
        eyes: fog.eyeCount(),
        // Two spots that answer the only question worth asking: is the enemy's
        // ground actually dark, and is your own actually clear?
        fogFar: fog.sample(v.terrain.W * 0.9, v.terrain.H * 0.5),
        fogHome: fog.sample(v.terrain.W * 0.1, v.terrain.H * 0.5),
        hedges: world ? world.hedges.counts : null,
        bridges: world ? world.bridges.counts : null,
        base: world ? world.base.counts : null,
        clutter: clutter.counts(),
        life: life.counts(),
        decals: !!(world && world.decals),
        marks: world && world.decals ? world.decals.uploads() : 0,
      };
    },

    /** Every object in the scene, by name, so a stray one can be found by
     *  switching things off until it goes. Debug only. */
    layers() {
      const out = [];
      scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh && !o.isPoints) return;
        o.geometry.computeBoundingSphere();
        const b = o.geometry.boundingSphere;
        out.push({ o, name: o.name || o.type, r: b ? Math.round(b.radius) : -1,
          n: o.isInstancedMesh ? o.count : 1, vis: o.visible });
      });
      return out;
    },

    dispose() {
      clearWorld();
      sky3.dispose();
      sky3 = null;
      clutter.dispose();
      clutter = null;
      life.dispose();
      life = null;
      fog.dispose();
      units.dispose();
      units = null;
      dust.dispose();
      dust = null;
      renderer.dispose();
    },
  };
}
