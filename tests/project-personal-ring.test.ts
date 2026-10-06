import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createProjectRing, filmPoint, PROJECT_FILM, PROJECT_RING, ringPosition, ringProjectIndex } from '../src/components/scene/project-ring.ts';

const CONTENT_COUNT = 7;
const positions = [-7000.51, -14.01, -7.01, -0.51, -0.01, 0, 0.49, 0.51, 6.49, 6.51, 6.99, 7.01, 14.01, 7000.51];

test('seven supplied screenshots fill the existing film continuously and repeat in submission order', () => {
  const textures = Array.from({ length: CONTENT_COUNT }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const lower = new THREE.Vector3(), upper = new THREE.Vector3();
  try {
    for (const position of positions) {
      ring.update(position);
      const cards = ring.group.children.filter(card => card.visible)
        .sort((a, b) => a.userData.centerDistance - b.userData.centerDistance);
      assert.ok(cards.length > CONTENT_COUNT, 'the physical ribbon repeats content instead of leaving unused cards blank');
      assert.equal(ring.diagnostics.contentCount, CONTENT_COUNT);
      assert.equal(ring.diagnostics.panelCount, PROJECT_FILM.slotCount);
      assert.equal(ring.activeIndex, ringProjectIndex(position, CONTENT_COUNT));
      const nearest = cards.reduce((a, b) => Math.abs(a.userData.centerDistance) < Math.abs(b.userData.centerDistance) ? a : b);
      assert.equal(nearest.userData.projectIndex, ring.activeIndex, 'the centered card and caption selection share one logical index');
      assert.ok(cards[0].userData.centerDistance - PROJECT_FILM.pitch / 2 <= PROJECT_FILM.visibleStartDistance, 'the first visible card reaches the hidden incoming end');
      assert.ok(cards.at(-1)!.userData.centerDistance + PROJECT_FILM.pitch / 2 >= PROJECT_FILM.maxDistance, 'the last visible card reaches the other end');
      for (const [index, card] of cards.entries()) {
        assert.equal(card.userData.projectIndex, ringPosition(card.userData.logicalIndex, CONTENT_COUNT));
        filmPoint(card.userData.centerDistance, -0.5, lower);
        filmPoint(card.userData.centerDistance, 0.5, upper);
        assert.ok(Math.abs(upper.distanceTo(lower) - PROJECT_RING.panelHeight) < 1e-8, 'repeated cards retain the approved height');
        if (index === 0) continue;
        const previous = cards[index - 1];
        assert.equal(card.userData.projectIndex, ringPosition(previous.userData.projectIndex + 1, CONTENT_COUNT), 'the last screenshot is followed by the first, including reverse travel');
        assert.ok(Math.abs(card.userData.centerDistance - previous.userData.centerDistance - PROJECT_FILM.pitch) < 1e-8, 'cards keep the approved pitch without a gap or overlap');
      }
    }
  } finally { ring.dispose(); textures.forEach(texture => texture.dispose()); }
});

test('the seven-card content cycle leaves the approved physical film unchanged through complete forward and reverse turns', () => {
  const textures = Array.from({ length: CONTENT_COUNT }, () => new THREE.Texture());
  const ring = createProjectRing(textures);
  const physicalSlots = [...ring.group.children];
  const snapshot = () => ring.group.children.filter(card => card.visible)
    .map(card => ({ project: card.userData.projectIndex, distance: card.userData.centerDistance, depth: card.renderOrder }))
    .sort((a, b) => a.distance - b.distance);
  try {
    for (const position of [-0.49, 0, 0.37, 6.93]) {
      ring.update(position);
      const original = snapshot();
      for (const direction of [-1, 1]) {
        ring.update(position + CONTENT_COUNT * direction);
        const repeated = snapshot();
        assert.equal(repeated.length, original.length);
        repeated.forEach((card, index) => {
          assert.equal(card.project, original[index].project);
          assert.ok(Math.abs(card.distance - original[index].distance) < 1e-8, 'a full content cycle has no spatial jump');
          assert.ok(Math.abs(card.depth - original[index].depth) < 1e-8, 'translucent rear depth ordering remains unchanged');
        });
      }
    }
    assert.deepEqual(ring.group.children, physicalSlots, 'cycling recycles the existing meshes');
  } finally { ring.dispose(); textures.forEach(texture => texture.dispose()); }
});

test('changing the media count retains the original entrance reveal, framing and media opening aspect', () => {
  const personalTextures = Array.from({ length: CONTENT_COUNT }, () => new THREE.Texture());
  const previousTextures = Array.from({ length: 11 }, () => new THREE.Texture());
  const personal = createProjectRing(personalTextures);
  const previous = createProjectRing(previousTextures);
  try {
    for (const selectedPosition of [-14, -1, 0, 6, 7, 14]) {
      for (const visiblePanels of [0, 2.5, 5.5, 7, 9, 11]) {
        const position = selectedPosition - 6.5 + visiblePanels / 11 * 6.5;
        const physicalStart = selectedPosition - 3;
        personal.update(position, 0, false, visiblePanels, physicalStart, 1440 / 900);
        previous.update(position, 0, false, visiblePanels, physicalStart, 1440 / 900);
        assert.deepEqual(personal.layout, previous.layout, 'media selection cannot resize the foreground or move the camera');
        assert.equal(personal.diagnostics.visiblePanels, visiblePanels, 'seven logical cards do not finish the eleven-panel entrance early');
        assert.equal(personal.diagnostics.entryStartIndex, previous.diagnostics.entryStartIndex);
        personal.group.children.forEach((card, index) => {
          const original = previous.group.children[index];
          assert.equal(card.userData.centerDistance, original.userData.centerDistance);
          assert.equal(card.userData.entryArcOrder, original.userData.entryArcOrder, 'the reveal follows physical slots rather than repeating every seven images');
          assert.equal(card.visible, original.visible);
        });
      }
    }
    assert.ok(Math.abs(PROJECT_FILM.mediaAspect - PROJECT_FILM.pitch * 0.954 / (PROJECT_RING.panelHeight * 0.878)) < 1e-12, 'contain fitting uses the opening between the preserved film borders');
  } finally {
    personal.dispose(); previous.dispose();
    [...personalTextures, ...previousTextures].forEach(texture => texture.dispose());
  }
});
