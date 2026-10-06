import { PlaneGeometry } from 'three/webgpu';
import { float, positionLocal, sin, uniform, vec3 } from 'three/tsl';

// Measured against the supplied clip and live hero (docs/hero-wave).
// A tiny sideways bend and a separate depth wave travel across the text sheet.
// Project their world-space amplitudes into the existing orthographic UI, so
// the accepted typography, parallax and monitor departure keep their layout.
const halfFov = 25 * Math.PI / 180;
const frontDistance = 6.5 / (1 + Math.tan(halfFov));
const surfaceHeight = 2 * Math.tan(halfFov) * frontDistance;

export function createHeroTextWave(width: number, height: number) {
  const phase = uniform(0);
  const amount = uniform(0);
  const aspect = uniform(width / height);
  const columnsFor = (w: number) => Math.max(2, Math.min(24, Math.round(w / 20)));
  let columns = columnsFor(width);
  let geometry = new PlaneGeometry(2, 2, columns, 12);
  const across = positionLocal.x.add(1).mul(0.5);
  const sideways = sin(across.mul(8).add(phase.mul(3))).mul(0.005 * 2 / surfaceHeight).mul(amount).div(aspect);
  const depth = sin(across.mul(10).add(phase.mul(4))).mul(0.007 / frontDistance).mul(amount);
  const perspective = float(1).sub(depth);
  const positionNode = vec3(positionLocal.x.sub(sideways).div(perspective), positionLocal.y.div(perspective), positionLocal.z);
  const diagnostics = { enabled: false, phase: 0, columns };

  return {
    get geometry() { return geometry; },
    positionNode,
    diagnostics,
    update(elapsed: number, enabled: boolean) {
      amount.value = enabled ? 1 : 0;
      if (enabled) phase.value = elapsed;
      diagnostics.enabled = enabled;
      diagnostics.phase = phase.value;
    },
    resize(w: number, h: number) {
      aspect.value = w / Math.max(1, h);
      const nextColumns = columnsFor(w);
      if (nextColumns !== columns) {
        geometry.dispose();
        geometry = new PlaneGeometry(2, 2, nextColumns, 12);
        columns = nextColumns;
        diagnostics.columns = columns;
      }
    },
    dispose() { geometry.dispose(); },
  };
}
