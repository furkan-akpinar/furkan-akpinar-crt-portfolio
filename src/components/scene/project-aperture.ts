import { Vector2, Vector3 } from 'three/webgpu';
import { atan, cos, dFdx, mx_fractal_noise_float, uniform, uv, vec2, vec3 } from 'three/tsl';
import { APERTURE_CHANNELS, sampleApertureChannel } from './project-aperture-motion';

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
  const diagnostics = { mobile: false, progress: 0, enabled: false, radius: 0, exposure: 0, glow: 0, centerX: 0, centerY: 0, phase7: 0, phase13: 0, clock: 0 };
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
    enabled, mask, rimColor, halo: halo.add(ember), exposure, diagnostics,
    update(progress: number, width: number, height: number, time: number, reduced: boolean) {
      const mobile = width < 900;
      enabled.value = progress > 0 && progress < 1 && !reduced ? 1 : 0;
      if (progress <= 0) startedAt = null;
      else if (startedAt === null) startedAt = time;
      aspect.value = width / Math.max(1, height);
      const sample = (values: readonly number[]) => sampleApertureChannel(values, progress, mobile, aspect.value);
      radius.value = sample(APERTURE_CHANNELS.radius);
      exposure.value = sample(APERTURE_CHANNELS.exposure);
      glowStrength.value = sample(APERTURE_CHANNELS.glow);
      center.value.set(sample(APERTURE_CHANNELS.centerX), sample(APERTURE_CHANNELS.centerY));
      // On mobile, even the edge detail belongs to the finger: holding,
      // releasing and retracing a drag must preserve the exact aperture pose.
      const motionTime = mobile ? progress * 2.4 : time;
      const drift = reduced ? 0 : Math.sin(motionTime * 0.8) * 0.18;
      phases.value.set(0, sample(APERTURE_CHANNELS.phase7) - drift, sample(APERTURE_CHANNELS.phase13) + drift);
      // Retain circular world-space growth on portrait screens, and ensure
      // completion covers ultrawide corners before handing off to the page.
      extent.value = Math.max(1, (width / height) / (1908 / 1074));
      clock.value = reduced ? 0 : mobile ? motionTime : time - (startedAt ?? time);
      diagnostics.mobile = mobile; diagnostics.progress = progress; diagnostics.enabled = !!enabled.value;
      diagnostics.radius = radius.value; diagnostics.exposure = exposure.value; diagnostics.glow = glowStrength.value;
      diagnostics.centerX = center.value.x; diagnostics.centerY = center.value.y;
      diagnostics.phase7 = phases.value.y; diagnostics.phase13 = phases.value.z; diagnostics.clock = clock.value;
    },
  };
}
