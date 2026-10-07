import { Vector2, Vector3 } from 'three/webgpu';
import { atan, cos, dFdx, mx_fractal_noise_float, uniform, uv, vec2, vec3 } from 'three/tsl';

// Radius is measured in viewport heights from the supplied 1908×1074 video.
// The first two holds are light/ember; the destination resolves after hold four.
const RADII = [-0.045, -0.017, 0.0228, 0.109, 0.270, 0.463, 0.739, 1.06, 1.50];
const EXPOSURE = [0, 0, 1, 1, 1, 0.20, 0.045, 0, 0];
const GLOW = [0, 0.035, 0.18, 0.40, 0.43, 0.065, 0.035, 0.012, 0];
const CENTER_X = [0.5286,0.5286,0.5286,0.54033,0.53973,0.532,0.537,0.537,0.537];
const CENTER_Y = [0.603,0.603,0.6029,0.52141,0.55008,0.637,0.636,0.636,0.636];
const PHASE_7 = [-1.077,-1.077,-1.077,-2.604,-2.344,-1.8,-1,-0.5,0];
const PHASE_13 = [-0.178,-0.178,-0.178,1.492,3.673,5.6,8.0,11.0,14.0];
const interpolate = (values: number[], p: number) => {
  const q = Math.max(0, Math.min(1, p)) * 8;
  const i = Math.min(7, Math.floor(q));
  const f = q - i;
  return values[i] + (values[i + 1] - values[i]) * f;
};

export function createProjectAperture() {
  let startedAt: number | null = null;
  const radius = uniform(-0.045);
  const exposure = uniform(0);
  const glowStrength = uniform(0);
  const enabled = uniform(0);
  const clock = uniform(0);
  const aspect = uniform(1);
  const center = uniform(new Vector2(0.532, 0.435));
  const extent = uniform(1);
  const phases = uniform(new Vector3());
  const point = uv().sub(center).mul(vec2(aspect, 1)).div(extent);
  // The reference's measured radial profile has three large lobes, seven
  // secondary lobes and thirteen fine ones. Screen-space noise only breaks
  // up their edge; it does not replace that measured silhouette.
  const angle = atan(point.y,point.x);
  const silhouette = cos(angle.mul(3).sub(clock.mul(1.5).sub(0.86))).mul(0.085)
    .add(cos(angle.mul(7).sub(phases.y)).mul(0.050))
    .add(cos(angle.mul(13).sub(phases.z)).mul(0.021)).add(1);
  const branches = mx_fractal_noise_float(vec3(point.mul(24), clock.mul(0.10)), 3);
  const flecks = mx_fractal_noise_float(vec3(point.mul(115), clock.mul(0.30)), 3);
  const fine = mx_fractal_noise_float(vec3(point.mul(430), clock.mul(0.56)), 2);
  const growth = radius.max(0).mul(2).clamp(0, 1);
  const roughness = branches.mul(0.024).add(flecks.mul(0.019)).add(fine.mul(0.006));
  const smoothDistance = point.length().sub(radius.mul(silhouette));
  const distance = smoothDistance.add(roughness.mul(growth));
  const mask = distance.smoothstep(-0.0015, 0.0015).oneMinus();
  const rim = distance.abs().smoothstep(0.0005, 0.003).oneMinus();
  const fringe = dFdx(distance).mul(0.85);
  const rimColor = vec3(distance.add(fringe).abs().smoothstep(0.0005,0.003).oneMinus(),rim,distance.sub(fringe).abs().smoothstep(0.0005,0.003).oneMinus());
  // Only the luminous filament fragments. The broader optical halo is smooth.
  const halo = smoothDistance.max(0).mul(-28).exp().mul(glowStrength).mul(smoothDistance.smoothstep(-0.002,0.004));
  const ember = point.length().mul(-25).exp().mul(glowStrength).mul(radius.smoothstep(-0.02, 0.02).oneMinus());
  return {
    enabled, mask, rimColor, halo: halo.add(ember), exposure,
    update(progress: number, width: number, height: number, time: number, reduced: boolean) {
      enabled.value = progress > 0 && progress < 1 && !reduced ? 1 : 0;
      if (progress <= 0) startedAt = null;
      else if (startedAt === null) startedAt = time;
      radius.value = interpolate(RADII, progress);
      exposure.value = interpolate(EXPOSURE, progress);
      glowStrength.value = interpolate(GLOW, progress);
      aspect.value = width / Math.max(1, height);
      center.value.set(interpolate(CENTER_X,progress),interpolate(CENTER_Y,progress));
      const drift = reduced ? 0 : Math.sin(time * 0.8) * 0.18;
      phases.value.set(0,interpolate(PHASE_7,progress)-drift,interpolate(PHASE_13,progress)+drift);
      // Retain circular world-space growth on portrait screens, and ensure
      // completion covers ultrawide corners before handing off to the page.
      extent.value = Math.max(1, (width / height) / (1908 / 1074));
      clock.value = reduced ? 0 : time - (startedAt ?? time);
    },
  };
}
