import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createProjectRing, filmAngleAtDistance, filmPoint, PROJECT_FILM, PROJECT_RING, ringPathOpacity, ringPoint, ringPosition, ringProjectIndex } from '../src/components/scene/project-ring.ts';

test('film selection crosses the last/first boundary in both directions without changing travel distance', () => {
  assert.equal(ringProjectIndex(10.49, 11), 10);
  assert.equal(ringProjectIndex(10.51, 11), 0);
  assert.equal(ringProjectIndex(-0.51, 11), 10);
  assert.equal(ringProjectIndex(11000.51, 11), 1);
  for (const position of [-220.75, -11.01, -0.01, 0, 10.99, 11.01, 1000.4]) {
    assert.ok(Math.abs(ringPosition(position + 11, 11) - ringPosition(position, 11)) < 1e-10);
  }
});

test('the accepted S contour remains connected and retains its closed return at physical depth', () => {
  const first = new THREE.Vector3();
  const last = new THREE.Vector3();
  const step = Math.PI * 2 / 11;
  for (const position of [-11.5, -0.02, 0, 3.7, 10.98, 22.15]) {
    for (let panel = 0; panel < 11; panel++) {
      for (const height of [-0.5, 0.5]) {
        ringPoint((panel + 0.5 - position) * step, height, first);
        ringPoint(((panel + 1) % 11 - 0.5 - position) * step, height, last);
        assert.ok(first.distanceTo(last) < 1e-10, 'every panel edge joins its neighbour, including the closing edge');
      }
    }
  }
  ringPoint(0, 0, first);
  ringPoint(Math.PI, 0, last);
  assert.equal(Math.abs(first.z), 0);
  assert.ok(last.z < first.z - PROJECT_RING.panelHeight * 2, 'the rear is physically behind the near film');
  assert.ok(last.y > first.y + PROJECT_RING.panelHeight * 0.8, 'the rear remains raised above the near film');
});

test('the closed film keeps upright edges and continuous tangents through both rear turns', () => {
  const lower = new THREE.Vector3();
  const upper = new THREE.Vector3();
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const center = new THREE.Vector3();
  const incoming = new THREE.Vector3();
  const outgoing = new THREE.Vector3();
  const angles = Array.from({ length: 241 }, (_, index) => -Math.PI + index * Math.PI / 120);
  angles.push(-2, -1.6, -1.05, 1.05, 1.35, -Math.acos(-0.505), -Math.acos(-0.74), -Math.acos(-0.84), Math.PI, -Math.PI);
  for (const angle of angles) {
    ringPoint(angle, -0.5, lower);
    ringPoint(angle, 0.5, upper);
    assert.ok(Math.abs(upper.x - lower.x) < 1e-10);
    assert.ok(Math.abs(upper.z - lower.z) < 1e-10);
    assert.ok(Math.abs(upper.y - lower.y - PROJECT_RING.panelHeight) < 1e-10, 'the strip retains its height around the whole loop');
    // These are the authored curve's angular parameters. Rendered panels use
    // physical distance instead; the raw curve must retain continuous tangents.
    const velocityJump = (epsilon: number) => {
      ringPoint(angle - epsilon, 0, before); ringPoint(angle, 0, center); ringPoint(angle + epsilon, 0, after);
      incoming.subVectors(center, before).divideScalar(epsilon);
      outgoing.subVectors(after, center).divideScalar(epsilon);
      return incoming.distanceTo(outgoing);
    };
    assert.ok(velocityJump(0.00001) < velocityJump(0.001) * 0.2 + 0.00001,
      'both sides approach the same tangent, including the rear closing point');
  }
});

test('the accepted S contour preserves its measured foreground landmarks', () => {
  // Fresh round6 full-viewport Alamance reference, 1918x1078 DPR1:
  // centre media ~642x461, right media ~390 wide (black panel gap excluded),
  // Media playback differs, so these contour measurements are the preservation
  // limit, not a claim of pixel equality with the new eHealth reference.
  const camera = new THREE.PerspectiveCamera(42, 1918 / 1078, 0.1, 500);
  camera.position.set(0, 0, PROJECT_RING.cameraDistance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new THREE.Vector3();
  const step = Math.PI * 2 / 11;
  function screen(angle: number, vertical: number) {
    ringPoint(angle, vertical, point);
    point.y += PROJECT_RING.centerY;
    point.project(camera);
    return [(point.x + 1) * 959, (1 - point.y) * 539];
  }
  const left = screen(-step * 0.477, 0.439);
  const right = screen(step * 0.477, 0.439);
  const lower = screen(step * 0.477, -0.439);
  const outer = screen(step * 1.477, 0.439);
  assert.ok(Math.abs(right[0] - left[0] - 642) < 15);
  assert.ok(Math.abs(lower[1] - right[1] - 461) < 15);
  assert.ok(Math.abs(outer[0] - screen(step * 0.523, 0.439)[0] - 390) < 15);
});

test('bending the compact S preserves the established near contour', () => {
  // Frozen source checkpoint coordinates, sampled before the S-tail change.
  const landmarks: Array<[number, number, number, number]> = [
    [-1.05, -7.453602161500848, -1.627230124677694, -5.1240695683526365],
    [-0.8, -5.688157042838355, -1.1871421916537623, -3.152958084869244],
    [-0.5, -3.56007941827253, -0.7143407572741448, -1.2945407491587817],
    [0, 0.031, 0, 0],
    [0.5, 3.534921013127136, 0.7045573942390406, -1.066990390563511],
    [0.8, 5.490328843805934, 1.1143714649551408, -2.643504321330106],
    [1.05, 7.1254881508894465, 1.473058591181554, -4.379170746575707],
  ];
  const point = new THREE.Vector3();
  for (const [angle, x, y, z] of landmarks) {
    ringPoint(angle, 0, point);
    assert.ok(point.distanceTo(new THREE.Vector3(x, y, z)) < 1e-9, `foreground angle ${angle} remains unchanged`);
  }
});

test('distance sampling keeps the accepted S silhouette and foreground card size', () => {
  const sampled = new THREE.Vector3();
  const authored = new THREE.Vector3();
  for (let sample = 0; sample <= 4096; sample++) {
    const distance = PROJECT_FILM.minDistance + PROJECT_FILM.length * sample / 4096;
    filmPoint(distance, 0, sampled);
    ringPoint(filmAngleAtDistance(distance), 0, authored);
    assert.ok(sampled.distanceTo(authored) < 0.005, 'resampling cannot reshape or lengthen the approved curve');
  }
  for (const [width, height, cameraDistance] of [[1440, 900, 8.604870129870129], [1918, 955, 7.8]]) {
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 500);
    camera.position.z = cameraDistance;
    camera.updateMatrixWorld();
    for (const horizontal of [-0.477, 0.477]) {
      for (const vertical of [-0.439, 0.439]) {
        ringPoint(horizontal * Math.PI * 2 / 11, vertical, authored);
        filmPoint(horizontal * PROJECT_FILM.pitch, vertical, sampled);
        authored.y += PROJECT_RING.centerY;
        sampled.y += PROJECT_RING.centerY;
        authored.project(camera);
        sampled.project(camera);
        assert.ok(Math.abs(sampled.x - authored.x) * width / 2 < 3, `${width}px foreground X must stay within three pixels`);
        assert.ok(Math.abs(sampled.y - authored.y) * height / 2 < 3, `${width}px foreground Y must stay within three pixels`);
      }
    }
  }
});

test('every visible card quarter has the same physical width without rear image stretching', () => {
  const point = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const quarterPitch = PROJECT_FILM.pitch / 4;
  const start = PROJECT_FILM.visibleStartDistance + PROJECT_FILM.pitch / 2;
  const end = PROJECT_FILM.maxDistance - PROJECT_FILM.pitch / 2;
  for (let sample = 0; sample <= 64; sample++) {
    const center = start + (end - start) * sample / 64;
    for (let quarter = 0; quarter < 4; quarter++) {
      const distance = center + (quarter / 4 - 0.5) * PROJECT_FILM.pitch;
      filmPoint(distance, 0, previous);
      let width = 0;
      for (let segment = 1; segment <= 128; segment++) {
        filmPoint(distance + quarterPitch * segment / 128, 0, point);
        width += point.distanceTo(previous);
        previous.copy(point);
      }
      // Allow the sampled surface's tiny chord error at its tightest bend;
      // the old angular mapping varied by approximately 100% at the rear.
      assert.ok(Math.abs(width - quarterPitch) < quarterPitch * 0.005,
        `card quarter at ${distance} has width ${width}, expected ${quarterPitch} within 0.5%`);
    }
    filmPoint(center, -0.5, previous);
    filmPoint(center, 0.5, point);
    assert.ok(Math.abs(point.distanceTo(previous) - PROJECT_RING.panelHeight) < 1e-10, 'equal widths retain the established film height');
  }
});

test('physical slots recycle only after the complete panel leaves the visible S', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const slots = [...ring.group.children];
  const outside = (center: number) => center + PROJECT_FILM.pitch / 2 <= PROJECT_FILM.visibleStartDistance
    || center - PROJECT_FILM.pitch / 2 >= PROJECT_FILM.maxDistance;
  const snapshot = () => slots.map(slot => ({ logical: slot.userData.logicalIndex, project: slot.userData.projectIndex, distance: slot.userData.centerDistance }));
  try {
    for (const direction of [-1, 1]) {
      ring.update(0);
      let previous = snapshot();
      let recycled = 0;
      for (let tick = 1; tick <= 880; tick++) {
        ring.update(direction * tick / 20);
        const current = snapshot();
        current.forEach((slot, index) => {
          if (slot.logical !== previous[index].logical) {
            recycled++;
            assert.ok(outside(previous[index].distance), 'the departing slot must already be entirely invisible');
            assert.ok(outside(slot.distance), 'the reassigned slot must arrive entirely outside the visible path');
            assert.equal(Math.abs(slot.logical - previous[index].logical), PROJECT_FILM.slotCount);
          } else {
            assert.equal(slot.project, previous[index].project, 'a visible card keeps its media throughout its travel');
            assert.ok(Math.abs(slot.distance - previous[index].distance + direction * PROJECT_FILM.pitch / 20) < 1e-10,
              'a non-recycled card advances at constant physical speed');
          }
        });
        previous = current;
      }
      assert.ok(recycled > 0, 'the test must cross real pool recycling boundaries in each direction');
    }
    assert.deepEqual(ring.group.children, slots, 'recycling changes ownership without rebuilding meshes');
  } finally { ring.dispose(); textures.forEach(item => item.dispose()); }
});

test('uniform cards remain edge-connected and synchronized with project selection through both wraps', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const point = new THREE.Vector3();
  const neighbour = new THREE.Vector3();
  try {
    for (const position of [-22.05, -11.01, -0.51, -0.01, 0, 0.125, 0.49, 5.43, 10.95, 11.05, 22.01]) {
      ring.update(position);
      const visible = ring.group.children.filter(slot => slot.visible)
        .sort((a, b) => a.userData.centerDistance - b.userData.centerDistance);
      const nearest = visible.reduce((a, b) => Math.abs(a.userData.centerDistance) < Math.abs(b.userData.centerDistance) ? a : b);
      assert.equal(nearest.userData.projectIndex, ring.activeIndex, 'the title selection belongs to the nearest physical card');
      assert.equal(ring.activeIndex, ringProjectIndex(position, 11));
      for (let index = 1; index < visible.length; index++) {
        const left = visible[index - 1];
        const right = visible[index];
        assert.equal(right.userData.projectIndex, ringPosition(left.userData.projectIndex + 1, 11), 'content order remains consecutive through the final/first project');
        assert.ok(Math.abs(right.userData.centerDistance - left.userData.centerDistance - PROJECT_FILM.pitch) < 1e-10,
          'adjacent physical cards leave neither a gap nor an overlap');
        for (const vertical of [-0.5, 0.5]) {
          filmPoint(left.userData.centerDistance + PROJECT_FILM.pitch / 2, vertical, point);
          filmPoint(right.userData.centerDistance - PROJECT_FILM.pitch / 2, vertical, neighbour);
          assert.ok(point.distanceTo(neighbour) < 1e-10, 'upper and lower film rails join at each card boundary');
        }
      }
    }
  } finally { ring.dispose(); textures.forEach(item => item.dispose()); }
});

test('translucent rear sorting follows physical depth continuously through both wrap directions', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const point = new THREE.Vector3();
  try {
    for (const position of [-11.01, -0.51, -0.01, 0, 0.33, 5.5, 10.99, 11.01]) {
      ring.update(position);
      const ordered = ring.group.children.filter(panel => panel.visible).map(panel => {
        filmPoint(panel.userData.centerDistance, 0, point);
        return { order: panel.renderOrder, z: point.z };
      }).sort((a, b) => a.order - b.order);
      for (let index = 1; index < ordered.length; index++) {
        assert.ok(ordered[index].z >= ordered[index - 1].z - 1e-10, 'far material is submitted before the near material');
      }
      const visibleSnapshot = () => ring.group.children.filter(panel => panel.visible)
        .map(panel => ({ project: panel.userData.projectIndex, distance: panel.userData.centerDistance, z: panel.renderOrder }))
        .sort((a, b) => a.distance - b.distance);
      const snapshot = visibleSnapshot();
      ring.update(position + 11);
      const repeated = visibleSnapshot();
      assert.equal(repeated.length, snapshot.length);
      repeated.forEach((panel, index) => {
        assert.equal(panel.project, snapshot[index].project, 'content repeats after eleven projects even when a different pool slot renders it');
        assert.ok(Math.abs(panel.distance - snapshot[index].distance) < 1e-10);
        assert.ok(Math.abs(panel.z - snapshot[index].z) < 1e-10);
      });
    }
  } finally { ring.dispose(); textures.forEach(item => item.dispose()); }
});

test('the Alamance foreground landmarks survive the narrower desktop viewport', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const camera = new THREE.PerspectiveCamera(42, 1440 / 900, 0.1, 500);
  const point = new THREE.Vector3();
  try {
    ring.update(3, false, 11, 8, 1440 / 900);
    camera.position.z = ring.layout.cameraDistance; camera.updateMatrixWorld();
    const screenX = (distance: number) => {
      filmPoint(distance, 0.4395, point); point.y += PROJECT_RING.centerY; point.project(camera);
      return (point.x + 1) * 720;
    };
    assert.ok(Math.abs(screenX(-0.4755 * PROJECT_FILM.pitch) - 474) < 8, 'near left edge measured in the reference full frame');
    assert.ok(Math.abs(screenX(0.4755 * PROJECT_FILM.pitch) - 974) < 8, 'near right edge measured in the reference full frame');
  } finally { ring.dispose(); textures.forEach(item => item.dispose()); }
});

test('media updates reuse the physical slot pool and do not advance the carousel', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const panels = [...ring.group.children];
  const mediaIndices = ring.mediaIndices;
  try {
    ring.update(10.9);
    assert.equal(ring.activeIndex, 0);
    assert.deepEqual(mediaIndices, [10, 0, 1]);
    ring.update(11.1);
    assert.equal(ring.diagnostics.position, 11.1, 'unbounded position is never reset to a different turn');
    assert.equal(ring.activeIndex, 0);
    textures[0].needsUpdate = true;
    ring.update(11.1);
    assert.equal(ring.diagnostics.position, 11.1, 'media updates do not advance film position');
    assert.equal(ring.mediaIndices, mediaIndices, 'per-frame media selection reuses its array');
    assert.deepEqual(ring.group.children, panels, 'slot meshes are reused without rebuilding at a project boundary');
    assert.equal(panels.length, PROJECT_FILM.slotCount);
    assert.equal(ring.diagnostics.contentCount, 11, 'physical slots do not add projects');
    assert.equal(ring.diagnostics.panelCount, PROJECT_FILM.slotCount);
    assert.equal(ring.diagnostics.drawCalls, panels.filter(panel => panel.visible).length);
    assert.equal(new Set(panels.map(panel => (panel as THREE.Mesh).geometry)).size, 1);
  } finally {
    ring.dispose();
    textures.forEach(item => item.dispose());
  }
});

test('the compact S stays below the navigation without enlarging the desktop horizontal footprint', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const point = new THREE.Vector3();
  try {
    // Round9 deliberately bends the rear higher than the old flat rail.
    // Retain the old camera and horizontal/bottom footprint, allowing the
    // compact bend to rise within the heading area, never to the navigation.
    for (const [width, height, cameraDistance, minX, maxX, maxY] of [
      [1918, 955, 7.8, 224.736, 1687.448, 872.253],
      [1440, 900, 8.604870129870129, 65.610, 1363.488, 791.271],
    ]) {
      ring.update(0, false, 11, 8, width / height);
      assert.ok(Math.abs(ring.layout.cameraDistance - cameraDistance) < 1e-10, 'the compactness check cannot be satisfied by moving the camera');
      ring.group.updateMatrixWorld();
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 500);
      camera.position.z = ring.layout.cameraDistance;
      camera.updateMatrixWorld();
      for (let sample = 0; sample <= 2048; sample++) {
        const angle = -Math.PI + sample * Math.PI / 1024;
        for (const vertical of [-0.5, 0.5]) {
          ringPoint(angle, vertical, point);
          point.applyMatrix4(ring.group.matrixWorld).project(camera);
          const x = (point.x + 1) * width / 2;
          const y = (1 - point.y) * height / 2;
          assert.ok(x >= minX - 2 && x <= maxX + 2, `${width}px: compact S stays within the prior horizontal footprint`);
          assert.ok(y >= 150 && y <= maxY + 2, `${width}px: film y${y} stays below the navigation and above its existing lower edge`);
        }
      }
    }
  } finally { ring.dispose(); textures.forEach(item => item.dispose()); }
});

test('the compact S does not lengthen the film or extend its world-space depth', () => {
  // Round9 source-before, measured at the same 8192 samples: 69.1335555
  // world units. The hidden return is included: alpha cannot hide elongation.
  const point = new THREE.Vector3();
  const previous = new THREE.Vector3();
  ringPoint(-Math.PI, 0, previous);
  let length = 0;
  for (let sample = 0; sample <= 8192; sample++) {
    ringPoint(-Math.PI + sample * Math.PI / 4096, 0, point);
    if (sample > 0) length += point.distanceTo(previous);
    assert.ok(point.z >= -24.832001 && point.z <= 0.000001, 'the bend cannot create a deeper or nearer extension');
    previous.copy(point);
  }
  assert.ok(length <= 69.134, `total physical film length ${length} must not exceed the previous loop`);
});

test('the compact S fades at both ends and hides its periodic return for every project', () => {
  let previous = 0;
  for (let sample = 0; sample <= 256; sample++) {
    const angle = Math.PI - (Math.PI - 1.05) * sample / 256;
    const opacity = ringPathOpacity(angle);
    assert.ok(opacity >= 0 && opacity <= 1);
    assert.ok(opacity >= previous - 1e-10, 'the approaching end becomes continuously clearer');
    previous = opacity;
  }
  previous = 1;
  for (let sample = 0; sample <= 256; sample++) {
    const angle = -1.05 - (Math.PI - 1.05) * sample / 256;
    const opacity = ringPathOpacity(angle);
    assert.ok(opacity >= 0 && opacity <= 1);
    assert.ok(opacity <= previous + 1e-10, 'the outgoing end fades continuously into the hidden return');
    if (angle <= -1.6) assert.equal(opacity, 0, 'no second visible ribbon appears on the recycling path');
    previous = opacity;
  }
  for (let sample = 0; sample <= 240; sample++) {
    const angle = -Math.PI + sample * Math.PI / 120;
    const opacity = ringPathOpacity(angle);
    if (Math.abs(angle) <= 1.05) assert.equal(opacity, 1, 'the preserved foreground stays opaque');
    for (const turns of [-3, -1, 1, 3]) {
      assert.ok(Math.abs(opacity - ringPathOpacity(angle + turns * Math.PI * 2)) < 1e-10, 'opacity stays on the physical path through either project wrap');
    }
  }
  assert.equal(ringPathOpacity(Math.PI), 0);
  assert.equal(ringPathOpacity(-Math.PI), 0);
});

test('rear panel points remain periodic for every project and both travel directions', () => {
  const point = new THREE.Vector3();
  const repeated = new THREE.Vector3();
  for (let sample = 0; sample <= 240; sample++) {
    const angle = -Math.PI + sample * Math.PI / 120;
    for (const vertical of [-0.5, 0, 0.5]) {
      ringPoint(angle, vertical, point);
      for (const turns of [-3, -1, 1, 3]) {
        ringPoint(angle + turns * Math.PI * 2, vertical, repeated);
        assert.ok(point.distanceTo(repeated) < 1e-10, 'all film surfaces return to the same point without a rear seam');
      }
    }
  }
});

test('entry reveal stays in logical project order across the reusable slot pool', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const panels = [...ring.group.children];
  try {
    assert.equal(ring.diagnostics.visiblePanels, 11);
    assert.equal(ring.diagnostics.entryStartIndex, 8);
    panels.forEach(panel => assert.equal(panel.userData.entryArcOrder, ringPosition(panel.userData.projectIndex - 8, 11)));
    for (const visible of [0, 2, 5.5, 9, 11, 5.5, 0]) {
      ring.update(-5, false, visible);
      assert.equal(ring.diagnostics.visiblePanels, visible);
      assert.equal(ring.diagnostics.position, -5, 'arc visibility cannot move the carousel');
      assert.deepEqual(ring.group.children, panels, 'entry and reverse entry preserve the physical slot meshes');
    }
    ring.update(0, false, 30);
    assert.equal(ring.diagnostics.visiblePanels, 11);
    ring.update(0, false, -4);
    assert.equal(ring.diagnostics.visiblePanels, 0);
    ring.update(5, false, 5.5, 2);
    assert.equal(ring.diagnostics.entryStartIndex, 2);
    panels.forEach(panel => assert.equal(panel.userData.entryArcOrder, ringPosition(panel.userData.projectIndex - 2, 11)));
    assert.equal(ring.diagnostics.position, 5, 'returning to another project moves the reveal origin, not panel ownership');
    ring.update(0);
    assert.equal(ring.diagnostics.visiblePanels, 11, 'ordinary carousel callers always get the closed loop');
    assert.equal(ring.diagnostics.entryStartIndex, 8);
  } finally {
    ring.dispose(); textures.forEach(item => item.dispose());
  }
});

test('film cleanup releases shared geometry and materials once while preserving gallery textures', () => {
  const textures = Array.from({ length: 11 }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  let geometryDisposals = 0;
  let materialDisposals = 0;
  let pathDisposals = 0;
  let textureDisposals = 0;
  const panels = ring.group.children as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>[];
  panels[0].geometry.addEventListener('dispose', () => geometryDisposals++);
  const pathTexture = panels[0].userData.pathTexture as THREE.Texture;
  assert.ok(panels.every(panel => panel.userData.pathTexture === pathTexture), 'all slots share one distance lookup');
  pathTexture.addEventListener('dispose', () => pathDisposals++);
  panels.forEach(panel => panel.material.addEventListener('dispose', () => materialDisposals++));
  textures.forEach(item => item.addEventListener('dispose', () => textureDisposals++));
  ring.update(12.2, true);
  assert.equal(ring.layout.cameraDistance, PROJECT_RING.mobileCameraDistance);
  ring.dispose();
  ring.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, PROJECT_FILM.slotCount);
  assert.equal(pathDisposals, 1);
  assert.equal(textureDisposals, 0);
  assert.equal(ring.group.children.length, 0);
  textures.forEach(item => item.dispose());
});
