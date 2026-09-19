/*
 * The RideCheck exploded-view stage, in plain three.js.
 *
 * A port of the React Three Fiber stage on ridecheck.id, which is itself a web
 * rendition of the app's SceneKit view. Same model, same rules:
 *
 * - The camera never leaves its orbit sphere. Focusing an assembly moves and
 *   scales the *model* under a rig group instead, so orbit, damping and zone
 *   framing never fight each other.
 * - Parts fan out per cluster (what the visitor picked), not per assembly, so
 *   five small parts in one corner of the bay do not land on top of each other.
 * - Housings (`_static`) stay put: the wear parts come out, the housing stays
 *   behind, the way a mechanic lays them out on a bench.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BONDED_TO, isLabelCorner, partKeyOf, PARTS, ZONES, zoneById } from './parts.js';

const CAMERA_FOV = 34;
const ORBIT_ELEVATION = 0.3;
/* How far the establishing shot sits above centre, as a fraction of the
   vehicle's height — the canvas carries the paint picker along its bottom. */
const OVERVIEW_LIFT = 0.3;
const ENTRANCE_SECONDS = 1.6;
const HIGHLIGHT = new THREE.Color('#4AA3F5');

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/* Per-part material clones, so one group can fade without dragging every other
   group that shares `M_PartMetal` down with it. Idempotent by design. */
function collectMaterials(root) {
  const materials = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    const cloned = list.map((material) => {
      if (material.userData.rideCheckCloned) return material;
      const copy = material.clone();
      copy.userData.rideCheckCloned = true;
      copy.transparent = false;
      // The app ships silver paint for its light canvas; on a dark stage it
      // washes out to a flat white blob. Lower metalness lets the chosen
      // colour show instead of a reflection of the studio.
      if (copy.name.includes('CarPaint')) {
        copy.metalness = 0.18;
        copy.roughness = 0.34;
      }
      return copy;
    });
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
    materials.push(...cloned);
  });
  return materials;
}

/* `transparent` is a shader flag: flip it only on change, never per frame. */
function applyOpacity(material, opacity) {
  material.opacity = opacity;
  const wantsTransparent = opacity < 0.995;
  if (material.transparent !== wantsTransparent) {
    material.transparent = wantsTransparent;
    material.needsUpdate = true;
  }
  material.depthWrite = opacity > 0.65;
}

/* Fans a cluster's serviceable parts away from the vehicle: outward in the
   horizontal plane, spread into an arc, with a rising lift so labels stack. */
function explodeOffset(partCenter, groupCenter, outward, index, count, scale, spreadSign) {
  const spread = count > 1 ? (index - (count - 1) / 2) * (Math.PI / (count + 0.4)) * spreadSign : 0;
  const direction = outward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
  const radial = (0.85 + index * 0.34) * scale;
  const lift = (0.24 + index * 0.34) * scale;
  return direction
    .multiplyScalar(radial)
    .add(new THREE.Vector3(0, lift, 0))
    .add(partCenter.clone().sub(groupCenter).setY(0).multiplyScalar(0.4));
}

function buildRig(model) {
  model.updateMatrixWorld(true);

  const carBox = new THREE.Box3().setFromObject(model);
  const carCenter = carBox.getCenter(new THREE.Vector3());
  const carRadius = carBox.getBoundingSphere(new THREE.Sphere()).radius;
  const unit = carRadius / 3;

  const groups = [];
  const parts = [];
  const shells = [];

  const seenShell = new Set();
  model.traverse((child) => {
    if (!child.name.startsWith('SHELL_')) return;
    for (let parent = child.parent; parent; parent = parent.parent) {
      if (seenShell.has(parent)) return;
    }
    seenShell.add(child);
    shells.push({ name: child.name, object: child, materials: collectMaterials(child) });
  });

  model.traverse((child) => {
    if (!child.name.startsWith('GRP_')) return;
    const box = new THREE.Box3().setFromObject(child);
    groups.push({ name: child.name, object: child, center: box.getCenter(new THREE.Vector3()) });
  });

  const clusterOf = (groupName) => {
    const zone = ZONES.find((candidate) => candidate.groups.includes(groupName));
    if (!zone) return { key: groupName, corner: false };
    if (!zone.corners) return { key: zone.id, corner: false };
    const corner = /_(FL|FR|RL|RR)$/.exec(groupName);
    return { key: `${zone.id}_${corner ? corner[1] : 'x'}`, corner: true };
  };

  const clusters = new Map();
  for (const group of groups) {
    for (const child of group.object.children) {
      if (!child.name.startsWith('PART_')) continue;
      const box = new THREE.Box3().setFromObject(child);
      const member = { child, group, box, center: box.getCenter(new THREE.Vector3()) };
      const { key, corner } = clusterOf(group.name);
      const bucket = clusters.get(key);
      if (bucket) bucket.members.push(member);
      else clusters.set(key, { members: [member], corner });
    }
  }

  for (const { members, corner } of clusters.values()) {
    const clusterBox = new THREE.Box3();
    for (const member of members) clusterBox.union(member.box);
    const clusterCenter = clusterBox.getCenter(new THREE.Vector3());

    // A wheel corner comes apart along its axle — straight out of the side.
    // Bay assemblies lift out radially from the car's centre.
    const side = Math.sign(clusterCenter.x) || 1;
    const outward = corner
      ? new THREE.Vector3(side, 0, 0)
      : new THREE.Vector3(clusterCenter.x - carCenter.x, 0, clusterCenter.z - carCenter.z);
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    outward.normalize();
    const spreadSign = corner ? side : 1;

    // Stable order, so the same part gets the same label height every visit.
    const movable = members
      .filter((m) => !m.child.name.endsWith('_static') && !BONDED_TO[m.child.name])
      .sort((a, b) => a.child.name.localeCompare(b.child.name));

    const partScale = movable.length
      ? movable.reduce((sum, m) => sum + m.box.getBoundingSphere(new THREE.Sphere()).radius, 0) / movable.length
      : 0;
    // Travel scales with the parts themselves, not the cluster's volume.
    const spreadScale = THREE.MathUtils.clamp(partScale * 2.2, unit * 0.22, unit * 0.8);

    const offsets = new Map();
    movable.forEach(({ child, center }, index) => {
      offsets.set(child.name, explodeOffset(center, clusterCenter, outward, index, movable.length, spreadScale, spreadSign));
    });

    members.forEach(({ child, group, box, center }) => {
      const isStatic = child.name.endsWith('_static');
      const leader = BONDED_TO[child.name];
      const worldOffset = isStatic
        ? new THREE.Vector3()
        : (leader ? offsets.get(leader) : offsets.get(child.name)) || new THREE.Vector3();

      // Offsets are in model space but applied to `position`, which lives in
      // the parent's frame — and the root carries a Z-up → Y-up correction.
      const parentQuaternion = new THREE.Quaternion();
      (child.parent || model).getWorldQuaternion(parentQuaternion);
      const localOffset = worldOffset.clone().applyQuaternion(parentQuaternion.clone().invert());
      const localAnchor = child.worldToLocal(new THREE.Vector3(center.x, box.max.y, center.z));
      const key = partKeyOf(child.name);

      parts.push({
        name: child.name,
        object: child,
        restPosition: child.position.clone(),
        offset: localOffset,
        modelOffset: worldOffset.clone(),
        restBox: box.clone(),
        labelAnchor: localAnchor,
        partKey: key,
        labelled: key !== null && isLabelCorner(child.name),
        materials: collectMaterials(child),
        group: group.name,
      });
    });
  }

  const paintMaterials = shells.flatMap((s) => s.materials).filter((m) => m.name.includes('CarPaint'));

  return {
    parts,
    shells,
    paintMaterials,
    carCenter,
    carSize: carBox.getSize(new THREE.Vector3()),
    carMinY: carBox.min.y,
  };
}

/* A soft, radial contact shadow. Cheaper than real shadows and, under a car
   seen from three-quarters, indistinguishable. */
function makeShadow() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
  gradient.addColorStop(0.35, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(0.7, 'rgba(0,0,0,0.12)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.55 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}

export async function createStage(options) {
  const { container, labelLayer, modelUrl, reducedMotion = false, onSelect = () => {}, onHover = () => {}, onProgress = () => {} } = options;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Under 1.0 on purpose: the studio light is bright and the stage is dark.
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'r3d-canvas';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(4, 2.4, 5);

  // Local studio light for the metals, dialled back so the dark stage stays
  // dark; the directional lights do the actual shaping.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.45;

  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(5, 8, 4);
  scene.add(key);
  // A cool rim from behind, so the graphite shell separates from the dark.
  const rim = new THREE.DirectionalLight(0x7dc4ff, 2.2);
  rim.position.set(-6, 4, -6);
  scene.add(rim);
  const under = new THREE.PointLight(0x4aa3f5, 0.7);
  under.position.set(0, -2, 3);
  scene.add(under);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableZoom = false; // zoom is the zone chips' job; wheel zoom would eat page scroll
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.65;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.52;

  const spin = new THREE.Group();
  const rig = new THREE.Group();
  spin.add(rig);
  scene.add(spin);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(modelUrl, (event) => {
    if (event.lengthComputable) onProgress(event.loaded / event.total);
  });
  const model = gltf.scene;
  const built = buildRig(model);
  rig.add(model);

  const shadow = makeShadow();
  const groundY = built.carMinY - built.carCenter.y + built.carSize.y * OVERVIEW_LIFT;
  const shadowSize = Math.max(built.carSize.x, built.carSize.z);
  shadow.scale.set(shadowSize * 1.25, shadowSize * 0.8, 1);
  shadow.position.y = groundY - 0.01;
  scene.add(shadow);

  /* ── State ─────────────────────────────────────────────────────────── */

  const state = {
    zone: null,
    selected: null,
    active: true,
    interactive: true,
    framing: { center: new THREE.Vector3(), scale: 1, ready: false },
    entrance: 0,
  };
  let rigTarget = computeRigTarget(null);
  let activeGroups = new Set();

  function computeRigTarget(zone) {
    if (!zone) {
      const center = built.carCenter.clone();
      center.y -= built.carSize.y * OVERVIEW_LIFT;
      return { center, scale: 1 };
    }
    // Frame the parts that move — where they rest and where they fly to. The
    // housings are left out on purpose: the engine's runs the full length of
    // the car as its exhaust, and framing it centres the shot on the cabin.
    const box = new THREE.Box3();
    for (const part of built.parts) {
      if (!zone.groups.includes(part.group) || part.name.endsWith('_static')) continue;
      box.union(part.restBox);
      box.union(part.restBox.clone().translate(part.modelOffset));
    }
    if (box.isEmpty()) {
      for (const part of built.parts) {
        if (zone.groups.includes(part.group)) box.union(part.restBox.clone().translate(part.modelOffset));
      }
    }
    if (box.isEmpty()) return { center: built.carCenter.clone(), scale: 1 };
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const focusExtent = Math.max(size.x, size.y, size.z);
    const carExtent = Math.max(built.carSize.x, built.carSize.y, built.carSize.z);
    const scale = THREE.MathUtils.clamp((carExtent * 0.7) / Math.max(focusExtent, 0.001), 0.95, 1.9);
    return { center, scale };
  }

  /* ── Labels: DOM chips projected from each part every frame ─────────── */

  const labels = built.parts
    .filter((part) => part.labelled && part.partKey)
    .map((part) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'r3d-label';
      el.innerHTML = '<span class="r3d-label__dot"></span>' + PARTS[part.partKey].label;
      el.tabIndex = -1;
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect(state.selected === part.partKey ? null : part.partKey);
      });
      labelLayer.appendChild(el);
      return { part, el, visible: false, selected: false };
    });

  const projected = new THREE.Vector3();

  function updateLabels(width, height) {
    for (const label of labels) {
      const visible = activeGroups.has(label.part.group);
      if (visible !== label.visible) {
        label.visible = visible;
        label.el.classList.toggle('is-visible', visible);
        label.el.tabIndex = visible ? 0 : -1;
      }
      const selected = visible && state.selected === label.part.partKey;
      if (selected !== label.selected) {
        label.selected = selected;
        label.el.classList.toggle('is-selected', selected);
      }
      if (!visible) continue;
      projected.copy(label.part.labelAnchor);
      label.part.object.localToWorld(projected);
      projected.project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  /* ── Picking ────────────────────────────────────────────────────────── */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverKey = null;
  let downAt = null;

  function resolvePart(object) {
    for (let node = object; node; node = node.parent) {
      const match = built.parts.find((part) => part.object === node);
      if (match) return match;
    }
    return null;
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(model, true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      const part = resolvePart(hit.object);
      if (part && part.partKey && activeGroups.has(part.group)) return part;
      // The first opaque thing in the way wins; a ghosted shell does not.
      const mat = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
      if (mat && mat.opacity > 0.5) return null;
    }
    return null;
  }

  function onPointerMove(event) {
    if (!state.interactive || event.pointerType === 'touch') return;
    const part = pick(event);
    const keyNow = part ? part.partKey : null;
    if (keyNow === hoverKey) return;
    hoverKey = keyNow;
    canvas.style.cursor = keyNow ? 'pointer' : '';
    onHover(keyNow);
  }

  function onPointerDown(event) {
    downAt = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event) {
    if (!state.interactive || !downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return; // that was an orbit, not a tap
    const part = pick(event);
    if (part) onSelect(state.selected === part.partKey ? null : part.partKey);
    else onSelect(null);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    if (hoverKey !== null) {
      hoverKey = null;
      canvas.style.cursor = '';
      onHover(null);
    }
  });

  /* ── Camera framing ─────────────────────────────────────────────────── */

  let width = 1;
  let height = 1;

  // Fit the box against the vertical AND horizontal fields of view and take
  // the larger distance — a bounding-sphere fit leaves an elongated car small
  // in a wide frame. Reset on resize, like the site does.
  function fit() {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const aspect = Math.max(width / height, 0.35);
    const vFov = (CAMERA_FOV * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const halfLong = Math.max(built.carSize.x, built.carSize.z) / 2;
    const halfTall = built.carSize.y / 2;
    const padding = 1.06 + 0.26 * THREE.MathUtils.clamp(aspect - 1, 0, 1);
    const distance =
      Math.max(halfTall / Math.tan(vFov / 2), halfLong / Math.tan(hFov / 2)) * padding + halfLong * 0.4;
    const direction = new THREE.Vector3(0.66, ORBIT_ELEVATION, 0.74).normalize();
    camera.position.copy(direction.multiplyScalar(distance));
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.update();
  }

  fit();
  const resizeObserver = new ResizeObserver(() => {
    fit();
    if (!state.active) renderOnce();
  });
  resizeObserver.observe(container);

  /* ── Frame loop ─────────────────────────────────────────────────────── */

  const scratch = new THREE.Vector3();
  let rafId = 0;
  let last = performance.now();

  function step(rawDelta) {
    const delta = Math.min(rawDelta, 0.05);
    // Frame-rate independent easing: the same settle on 120 Hz and 30 Hz.
    const ease = reducedMotion ? 1 : 1 - Math.exp(-delta * 7);
    const fade = reducedMotion ? 1 : 1 - Math.exp(-delta * 9);

    const frame = state.framing;
    if (!frame.ready) {
      frame.center.copy(rigTarget.center);
      frame.scale = rigTarget.scale;
      frame.ready = true;
    } else {
      frame.center.lerp(rigTarget.center, ease);
      frame.scale = THREE.MathUtils.lerp(frame.scale, rigTarget.scale, ease);
    }
    // `scale · (p − center)`: centring has to be scaled too.
    rig.scale.setScalar(frame.scale);
    rig.position.copy(frame.center).multiplyScalar(-frame.scale);

    if (state.entrance < 1) {
      state.entrance = reducedMotion ? 1 : Math.min(1, state.entrance + delta / ENTRANCE_SECONDS);
    }
    const arrived = easeOutExpo(state.entrance);
    if (!state.zone && !reducedMotion) spin.rotation.y += delta * 0.1;
    spin.rotation.y += (1 - arrived) * delta * 0.55;
    spin.scale.setScalar(0.9 + 0.1 * arrived);

    for (const part of built.parts) {
      const isActive = activeGroups.has(part.group);
      scratch.copy(part.restPosition).addScaledVector(part.offset, isActive ? 1 : 0);
      part.object.position.lerp(scratch, ease);

      const dimmed = state.zone ? (isActive ? 1 : 0.12) : 1;
      const highlighted = isActive && state.selected !== null && part.partKey === state.selected;
      for (const material of part.materials) {
        applyOpacity(material, THREE.MathUtils.lerp(material.opacity, dimmed, fade));
        material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity || 0, highlighted ? 0.7 : 0, fade);
        if (highlighted) material.emissive.copy(HIGHLIGHT);
      }
    }

    for (const shell of built.shells) {
      // A ghosted hood still reads as "closed", so it goes entirely.
      const target = !state.zone
        ? 1
        : !state.zone.bodyStays
          ? 0
          : shell.name === 'SHELL_Hood'
            ? 0
            : shell.name === 'SHELL_Interior'
              ? 0.05
              : 0.1;
      for (const material of shell.materials) {
        applyOpacity(material, THREE.MathUtils.lerp(material.opacity, target, fade));
      }
      shell.object.visible = target > 0 || shell.materials.some((m) => m.opacity > 0.004);
    }

    shadow.material.opacity = THREE.MathUtils.lerp(shadow.material.opacity, state.zone ? 0 : 0.55, fade);
  }

  function renderOnce() {
    controls.update();
    renderer.render(scene, camera);
    updateLabels(width, height);
  }

  function loop(now) {
    if (!state.active) {
      rafId = 0;
      return;
    }
    const delta = (now - last) / 1000;
    last = now;
    step(delta);
    renderOnce();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId) return;
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  start();

  /* ── Public API ─────────────────────────────────────────────────────── */

  return {
    zones: ZONES,
    setZone(id) {
      state.zone = id ? zoneById(id) || null : null;
      state.selected = null;
      activeGroups = new Set(state.zone ? state.zone.groups : []);
      rigTarget = computeRigTarget(state.zone);
    },
    setSelected(keyValue) {
      state.selected = keyValue;
    },
    setPaint(hex) {
      for (const material of built.paintMaterials) material.color.set(hex);
      if (!state.active) renderOnce();
    },
    setActive(active) {
      state.active = active;
      if (active) start();
    },
    setInteractive(interactive) {
      state.interactive = interactive;
      controls.enabled = interactive;
      canvas.style.touchAction = interactive ? 'none' : 'pan-y';
      canvas.style.pointerEvents = interactive ? 'auto' : 'none';
    },
    dispose() {
      state.active = false;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      for (const part of built.parts) part.materials.forEach((m) => m.dispose());
      for (const shell of built.shells) shell.materials.forEach((m) => m.dispose());
      labels.forEach((l) => l.el.remove());
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
