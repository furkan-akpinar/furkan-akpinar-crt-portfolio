import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createPhones } from '../src/components/scene/later-models.ts';
import { contactCopyTop, contactPhoneElevation } from '../src/components/scene/contact-motion.ts';
import { mobilePhoneFraming, mobilePhoneOffsets, tieAudiencePlacement } from '../src/components/scene/later-composition.ts';

function projectedBounds(group: THREE.Object3D, camera: THREE.PerspectiveCamera, width: number, height: number) {
  const point = new THREE.Vector3();
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld).project(camera);
      const x = (point.x + 1) * width / 2;
      const y = (1 - point.y) * height / 2;
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
  });
  return bounds;
}

test('mobile phones fill the foreground and clear the closing copy in both scroll directions', () => {
  const width = 390, height = 844;
  const phones = createPhones();
  const baselines = phones.phones.map(phone => phone.position.clone());
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  const setPose = (progress: number) => {
    const framing = mobilePhoneFraming(progress);
    camera.position.set(4.6, framing.cameraY, 15.6); camera.lookAt(0, 0.6, 0); camera.updateMatrixWorld();
    phones.group.scale.setScalar(framing.scale);
    phones.group.rotation.y = -0.08 + progress * 0.22;
    phones.group.position.y = contactPhoneElevation(progress, true);
    phones.phones.forEach((phone, index) => {
      phone.position.copy(baselines[index]);
      phone.position.x += mobilePhoneOffsets[index].x;
      phone.position.z += mobilePhoneOffsets[index].z;
    });
    phones.group.updateMatrixWorld(true);
  };
  try {
    setPose(0.227);
    const left = projectedBounds(phones.phones[0], camera, width, height);
    const upright = projectedBounds(phones.phones[1], camera, width, height);
    const foreground = projectedBounds(phones.phones[2], camera, width, height);
    assert.ok(left.left < 0 && foreground.right > width && foreground.bottom > height, 'foreground phones must crop at the left, right and bottom edges');
    assert.ok(upright.top > 250 && upright.top < 330 && upright.bottom - upright.top > 250, 'the upright phone must stay recognizable above the foreground');

    const samples = Array.from({ length: 281 }, (_, index) => 0.3 + index * 0.002);
    for (const progress of [...samples, ...samples.toReversed()]) {
      setPose(progress);
      const bounds = projectedBounds(phones.group, camera, width, height);
      // Conservative 73px cap envelope for the 84px mobile closing headline.
      const titleTop = contactCopyTop(progress, height, 1, true) + 90 - 73;
      if (titleTop >= 0 && titleTop <= height) {
        assert.ok(titleTop - bounds.bottom >= 12, `progress ${progress}: phone bottom ${bounds.bottom}, headline top ${titleTop}`);
      }
    }
  } finally {
    phones.dispose();
  }
});

test('audience perspective forms a receding aisle and leaves room around the mobile tie', () => {
  const geometry = new THREE.PlaneGeometry(2.7, 3.9);
  const material = new THREE.MeshBasicNodeMaterial();
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const mobile = width < 650;
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
      camera.position.set(0, 0.72, mobile ? 14.5 : 10.5); camera.lookAt(0, 0.49, 0); camera.updateMatrixWorld();
      const figures = Array.from({ length: 8 }, (_, index) => {
        const placement = tieAudiencePlacement(index);
        const figure = new THREE.Mesh(geometry, material);
        figure.position.set(placement.x, placement.y, placement.z);
        figure.scale.set(placement.scale * placement.facing, placement.scale, placement.scale);
        figure.quaternion.copy(camera.quaternion); figure.updateMatrixWorld(true);
        return projectedBounds(figure, camera, width, height);
      });
      for (const [front, back] of [[figures[0], figures[3]], [figures[4], figures[7]]]) {
        assert.ok(back.bottom - back.top < (front.bottom - front.top) / 2, 'rear audience must project below half of foreground height');
      }
      if (mobile) {
        assert.ok(figures[3].right < width * 0.41 && figures[7].left > width * 0.59, 'the inner audience must leave the central tie corridor open');
      }
    }
  } finally {
    geometry.dispose(); material.dispose();
  }
});
