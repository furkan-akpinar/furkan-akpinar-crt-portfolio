import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createPhones } from '../src/components/scene/later-models.ts';
import { contactCopyTop, contactPhoneElevation } from '../src/components/scene/contact-motion.ts';

test('projected desktop telephones clear the incoming closing headline in both scroll directions', () => {
  const phones = createPhones();
  const camera = new THREE.PerspectiveCamera(38, 1440 / 900, 0.1, 100);
  const vertex = new THREE.Vector3();
  const samples = Array.from({ length: 56 }, (_, i) => 0.3 + i / 100);
  try {
    for (const p of [...samples, ...samples.toReversed()]) {
      const eased = p * p * (3 - 2 * p);
      camera.position.set(4.8, 6 - eased * 1.6, 10.8);
      camera.lookAt(0, 0.6, 0);
      camera.updateMatrixWorld();
      phones.group.scale.setScalar(1.5);
      phones.group.rotation.y = -0.08 + p * 0.22;
      phones.group.position.y = contactPhoneElevation(p, false);
      phones.group.updateMatrixWorld(true);
      let bottom = -Infinity;
      phones.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(camera);
          bottom = Math.max(bottom, (1 - vertex.y) * 450);
        }
      });
      // Conservative cap-height envelope of the 204px STIX headline; includes
      // extra space for the moving receiver and the final CRT composite.
      const titleTop = contactCopyTop(p, 900, 1, false) + 200 - 174;
      if (titleTop >= 0 && titleTop <= 900) {
        assert.ok(titleTop - bottom >= 24, `progress ${p}: phone bottom ${bottom}, headline top ${titleTop}`);
      }
    }
  } finally {
    phones.dispose();
  }
});
