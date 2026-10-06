/** Separate the monitor dolly from the film's approach inside that monitor.
 * Source: supplied recording, 13.50 / 13.63 / 13.75 / 14.00 / 14.50 seconds.
 * The film turns through the last projects while travelling along Z, not Y.
 */
export interface ProjectEntry {
  phase: number;
  camera: number;
  depth: number;
  turns: number;
  caption: number;
  offsetX: number;
  offsetY: number;
  visiblePanels: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const x=clamp(value);return x*x*(3-2*x); };
function monotoneCurve(times: readonly number[], values: readonly number[]) {
  const slopes=times.map((_,i)=>{
    if(i===0||i===times.length-1)return 0;
    const before=times[i]-times[i-1],after=times[i+1]-times[i];
    const left=(values[i]-values[i-1])/before,right=(values[i+1]-values[i])/after;
    const w1=2*after+before,w2=after+2*before;
    return left*right>0?(w1+w2)/(w1/left+w2/right):0;
  });
  return (t:number)=>{
    const i=Math.max(0,times.findIndex((end,index)=>index>0&&t<=end)-1);
    const span=times[i+1]-times[i],u=clamp((t-times[i])/span),u2=u*u,u3=u2*u;
    return (2*u3-3*u2+1)*values[i]+(u3-2*u2+u)*span*slopes[i]
      +(-2*u3+3*u2)*values[i+1]+(u3-u2)*span*slopes[i+1];
  };
}
const entranceTurn=monotoneCurve([0,1/3,0.422222,0.5,2/3,5/6,1],[-6.5,-6.3,-4.1,-2.3,-0.55,0,0]);
const entranceDepth=monotoneCurve([0,0.3,1/3,0.4,0.422222,0.5,2/3,1],[-280,-200,-90,-8,-2.17,-1.29,0,0]);

export function sampleProjectEntry(progress: number, reducedMotion: boolean, out: ProjectEntry): ProjectEntry {
  const p=clamp(Number.isFinite(progress)?progress:0);
  // Lenis uses smoothstep for the one-gesture snap. Undo it before authoring
  // the two independent moves, so camera easing is not applied twice.
  const t=reducedMotion?1:0.5-Math.sin(Math.asin(1-2*p)/3);
  out.phase=t;
  out.camera=smooth((t-0.08)/0.405);
  out.depth=reducedMotion?0:entranceDepth(t);
  out.turns=reducedMotion?0:entranceTurn(t);
  out.caption=smooth((t-0.44)/0.3);
  // Small alignment correction while the arc is inside the oblique monitor.
  // The depth approach and advancing leading edge provide the actual motion.
  const ray=Math.abs(out.depth)*smooth((t-0.35)/0.05)*(1-smooth((t-0.44)/0.06));
  out.offsetX=ray===0?0:ray*-0.25;out.offsetY=ray===0?0:ray*-0.035;
  // Dense source frames show Hamn (8) as a free leading edge, followed by
  // 9/10/0 on the return. The connected arc grows before closing into a loop.
  out.visiblePanels=11*smooth((t-0.246)/0.344);
  return out;
}
