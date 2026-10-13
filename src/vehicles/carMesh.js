/**
 * Procedural car meshes.
 *
 * Each car in the catalogue gets a genuinely different silhouette, proportions,
 * colour and detail set, so opponents are identifiable by shape and not only by
 * name. Everything is built from primitives at runtime - no downloads, no
 * licences to track.
 *
 * Child naming follows the CC0 Kenney vehicle convention (`body`,
 * `wheel-front-left`, ...) so the Kenney GLB models can be dropped in as a
 * documented fallback without changing any caller.
 *
 * @module vehicles/carMesh
 */

import * as THREE from '../../vendor/three/three.module.js';

/** Per-car body recipe. Dimensions in metres. */
const BODY_SHAPES = {
  kestrel: {
    length: 4.05,
    width: 1.78,
    rideHeight: 0.34,
    cabinLength: 2.0,
    cabinHeight: 0.62,
    cabinInset: 0.14,
    cabinOffset: -0.1,
    bonnetDrop: 0.12,
    wing: null,
    wheels: { radius: 0.33, width: 0.22, track: 1.52, wheelbase: 2.5 },
    extras: ['exhaustSingle', 'roofAerial'],
  },
  'metro-gt': {
    length: 4.7,
    width: 1.86,
    rideHeight: 0.32,
    cabinLength: 2.5,
    cabinHeight: 0.58,
    cabinInset: 0.1,
    cabinOffset: 0.0,
    bonnetDrop: 0.08,
    wing: null,
    wheels: { radius: 0.35, width: 0.24, track: 1.6, wheelbase: 2.78 },
    extras: ['exhaustTwin', 'mirrors'],
  },
  'volt-e': {
    length: 4.9,
    width: 1.94,
    rideHeight: 0.3,
    cabinLength: 2.9,
    cabinHeight: 0.6,
    cabinInset: 0.06,
    cabinOffset: 0.15,
    bonnetDrop: 0.02,
    wing: null,
    wheels: { radius: 0.37, width: 0.25, track: 1.66, wheelbase: 2.95 },
    extras: ['chargePort', 'lightBar', 'mirrors'],
  },
  'vantage-rs': {
    length: 4.5,
    width: 2.02,
    rideHeight: 0.22,
    cabinLength: 1.8,
    cabinHeight: 0.48,
    cabinInset: 0.2,
    cabinOffset: -0.25,
    bonnetDrop: 0.16,
    wing: { height: 0.62, span: 1.86, chord: 0.34 },
    wheels: { radius: 0.36, width: 0.3, track: 1.74, wheelbase: 2.62 },
    extras: ['exhaustTwin', 'splitter', 'mirrors'],
  },
  haulmaster: {
    length: 8.6,
    width: 2.45,
    rideHeight: 0.72,
    cabinLength: 2.5,
    cabinHeight: 1.5,
    cabinInset: 0.0,
    cabinOffset: 2.6,
    bonnetDrop: 0.0,
    wing: null,
    wheels: { radius: 0.55, width: 0.34, track: 1.98, wheelbase: 5.6 },
    extras: ['trailerBox', 'stackExhaust', 'mirrors', 'bullBar'],
  },
};

const CAR_COLORS = {
  kestrel: { body: 0x2f6fb5, trim: 0x1c2229, accent: 0xe8a33d },
  'metro-gt': { body: 0xb8352c, trim: 0x1a1c1f, accent: 0xd9d6cf },
  'volt-e': { body: 0x2ea37a, trim: 0x14231f, accent: 0x9fe8d0 },
  'vantage-rs': { body: 0xe8b12c, trim: 0x14161a, accent: 0x2b2f36 },
  haulmaster: { body: 0x4a5560, trim: 0x22262b, accent: 0xc2622a },
};

/**
 * Build a car.
 * @param {object} car catalogue car
 * @param {object} [opts] { shadows, opponent }
 * @returns {{group:THREE.Group, wheels:object, setSteer:Function, setWheelSpin:Function, dispose:Function, length:number, width:number}}
 */
export function buildCarMesh(car, opts = {}) {
  const shape = BODY_SHAPES[car?.id] ?? BODY_SHAPES.kestrel;
  const palette = opts.color ?? CAR_COLORS[car?.id] ?? CAR_COLORS.kestrel;
  const shadows = opts.shadows !== false;

  const group = new THREE.Group();
  group.name = `car.${car?.id ?? 'unknown'}`;

  const bodyMat = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.42, metalness: 0.42 });
  const trimMat = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.55, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.5, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1b2733,
    roughness: 0.12,
    metalness: 0.55,
    transparent: true,
    opacity: 0.86,
  });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xf6f2e2, emissive: 0xfff2c8, emissiveIntensity: 0.5, roughness: 0.25 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x6a1414, emissive: 0xff2a1e, emissiveIntensity: 0.35, roughness: 0.3 });

  const L = shape.length;
  const W = shape.width;
  const baseY = shape.rideHeight;

  // --- main body: lower tub + upper shoulders ---
  const body = new THREE.Group();
  body.name = 'body';

  const tub = new THREE.Mesh(new THREE.BoxGeometry(W, baseY + 0.34, L), bodyMat);
  tub.position.set(0, (baseY + 0.34) / 2 + 0.16, 0);
  tub.castShadow = shadows;
  tub.receiveShadow = shadows;
  body.add(tub);

  const shoulderY = baseY + 0.5 + 0.24 - shape.bonnetDrop * 0.5;
  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.48, L * 0.94), bodyMat);
  shoulder.position.set(0, shoulderY, -L * 0.01);
  shoulder.castShadow = shadows;
  body.add(shoulder);

  // Bonnet and deck, dropped slightly to give a real three-box or two-box read.
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.16, L * 0.3), bodyMat);
  bonnet.position.set(0, shoulderY + 0.22 - shape.bonnetDrop, -L * 0.3);
  bonnet.castShadow = shadows;
  body.add(bonnet);

  // --- cabin / greenhouse ---
  const cabinY = shoulderY + 0.24 + shape.cabinHeight / 2;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(W - shape.cabinInset * 2, shape.cabinHeight, shape.cabinLength),
    glassMat
  );
  cabin.position.set(0, cabinY, shape.cabinOffset);
  cabin.castShadow = shadows;
  cabin.name = 'cabin';
  body.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(W - shape.cabinInset * 2 - 0.06, 0.1, shape.cabinLength * 0.92), bodyMat);
  roof.position.set(0, cabinY + shape.cabinHeight / 2 + 0.03, shape.cabinOffset);
  roof.castShadow = shadows;
  body.add(roof);

  // --- lamps ---
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(W * 0.2, 0.14, 0.1), lampMat);
    head.position.set(side * W * 0.32, shoulderY + 0.1, -L / 2 + 0.04);
    body.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(W * 0.22, 0.13, 0.08), tailMat);
    tail.position.set(side * W * 0.31, shoulderY + 0.12, L / 2 - 0.03);
    body.add(tail);
  }

  // --- wheels ---
  const wheels = {};
  const wr = shape.wheels.radius;
  const ww = shape.wheels.width;
  const trackHalf = shape.wheels.track / 2;
  const wbHalf = shape.wheels.wheelbase / 2;
  const wheelGeo = new THREE.CylinderGeometry(wr, wr, ww, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wr * 0.56, wr * 0.56, ww * 1.04, 10);
  rimGeo.rotateZ(Math.PI / 2);

  const positions = {
    'wheel-front-left': [-trackHalf, wr, -wbHalf],
    'wheel-front-right': [trackHalf, wr, -wbHalf],
    'wheel-rear-left': [-trackHalf, wr, wbHalf],
    'wheel-rear-right': [trackHalf, wr, wbHalf],
  };
  for (const [name, [x, y, z]] of Object.entries(positions)) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, z);
    const tyre = new THREE.Mesh(wheelGeo, tyreMat);
    tyre.castShadow = shadows;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    pivot.add(tyre, rim);
    group.add(pivot);
    wheels[name] = pivot;
  }
  wheels.front = [wheels['wheel-front-left'], wheels['wheel-front-right']];
  wheels.rear = [wheels['wheel-rear-left'], wheels['wheel-rear-right']];
  wheels.all = [wheels['wheel-front-left'], wheels['wheel-front-right'], wheels['wheel-rear-left'], wheels['wheel-rear-right']];

  // --- extras ---
  for (const extra of shape.extras) {
    body.add(buildExtra(extra, { L, W, bodyMat, trimMat, accentMat, glassMat, baseY, shoulderY, shape }));
  }
  if (shape.wing) {
    const wing = new THREE.Group();
    wing.name = 'rearWing';
    const plane = new THREE.Mesh(new THREE.BoxGeometry(shape.wing.span, 0.06, shape.wing.chord), trimMat);
    plane.position.set(0, shape.wing.height, L / 2 - 0.22);
    plane.rotation.x = -0.16;
    plane.castShadow = shadows;
    wing.add(plane);
    for (const side of [-1, 1]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.07, shape.wing.height - 0.1, 0.14), trimMat);
      stay.position.set(side * shape.wing.span * 0.4, (shape.wing.height - 0.1) / 2 + 0.1, L / 2 - 0.22);
      wing.add(stay);
    }
    body.add(wing);
  }

  // Number roundel so opponents are distinguishable at a glance.
  if (opts.number) {
    const roundel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshStandardMaterial({ map: makeNumberTexture(opts.number), roughness: 0.6 })
    );
    roundel.position.set(0, shoulderY + 0.16, W * 0 + 0.01);
    roundel.rotation.y = Math.PI / 2;
    roundel.position.x = W / 2 + 0.01;
    body.add(roundel);
    const roundel2 = roundel.clone();
    roundel2.position.x = -W / 2 - 0.01;
    roundel2.rotation.y = -Math.PI / 2;
    body.add(roundel2);
  }

  group.add(body);

  // --- driver-visible state helpers ---
  let spin = 0;
  const api = {
    group,
    body,
    wheels,
    length: L,
    width: W,
    height: cabinY + shape.cabinHeight / 2 + 0.1,
    /** Front wheel angle in radians. Positive is left, matching the physics. */
    setSteer(radians) {
      for (const w of wheels.front) w.rotation.y = radians;
    },
    /** Roll the wheels to match speed. */
    setWheelSpin(speed, dt) {
      spin += (speed / Math.max(0.1, wr)) * dt;
      for (const w of wheels.all) w.children[0].rotation.x = spin;
    },
    setBrakeLights(on) {
      tailMat.emissiveIntensity = on ? 2.4 : 0.35;
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      });
    },
  };
  return api;
}

function buildExtra(kind, ctx) {
  const g = new THREE.Group();
  const { L, W, trimMat, accentMat, baseY, shoulderY, shape } = ctx;
  switch (kind) {
    case 'exhaustSingle': {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 8), trimMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(-W * 0.24, baseY + 0.2, L / 2 + 0.02);
      g.add(pipe);
      break;
    }
    case 'exhaustTwin': {
      for (const side of [-1, 1]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.26, 8), trimMat);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(side * W * 0.26, baseY + 0.22, L / 2 + 0.02);
        g.add(pipe);
      }
      break;
    }
    case 'stackExhaust': {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 10), trimMat);
      pipe.position.set(W * 0.42, shoulderY + 0.9, 0.4);
      g.add(pipe);
      break;
    }
    case 'roofAerial': {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.7, 5), trimMat);
      rod.position.set(-W * 0.3, shoulderY + 0.72, 0.5);
      g.add(rod);
      break;
    }
    case 'mirrors': {
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.08), trimMat);
        arm.position.set(side * (W / 2 + 0.12), shoulderY + 0.42, -shape.cabinLength * 0.3);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.16), trimMat);
        head.position.set(side * (W / 2 + 0.24), shoulderY + 0.44, -shape.cabinLength * 0.3);
        g.add(arm, head);
      }
      break;
    }
    case 'splitter': {
      const s = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, 0.07, 0.5), trimMat);
      s.position.set(0, baseY + 0.06, -L / 2 + 0.1);
      g.add(s);
      break;
    }
    case 'lightBar': {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.07, 0.1), accentMat);
      bar.position.set(0, shoulderY + 0.16, -L / 2 + 0.05);
      g.add(bar);
      break;
    }
    case 'chargePort': {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.04), trimMat);
      port.position.set(-W / 2 - 0.01, shoulderY + 0.2, -L * 0.24);
      port.rotation.y = Math.PI / 2;
      g.add(port);
      break;
    }
    case 'trailerBox': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 2.7, L * 0.52), trimMat);
      box.position.set(0, baseY + 1.55, L * 0.2);
      box.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 0.99, 0.34, L * 0.52), accentMat);
      stripe.position.set(0, baseY + 2.2, L * 0.2);
      g.add(box, stripe);
      // Extra rear axle set for a truck.
      break;
    }
    case 'bullBar': {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.5, 0.16), trimMat);
      bar.position.set(0, baseY + 0.5, -L / 2 - 0.06);
      g.add(bar);
      break;
    }
    default:
      break;
  }
  return g;
}

function makeNumberTexture(n) {
  const size = 128;
  let canvas;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
  } else {
    return null;
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f2ec';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1c1e21';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = '#1c1e21';
  ctx.font = 'bold 66px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { BODY_SHAPES, CAR_COLORS };
