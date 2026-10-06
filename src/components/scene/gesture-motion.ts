const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const smooth = (n: number) => { const t=clamp(n); return t*t*(3-2*t); };

// Independent idle applause was observed live. These periods are authored
// approximations: dropped/repeated reference video frames prevent exact timing.
export const applausePeriods = [0.92,1.13,1.02,1.24,1.08,0.98,1.19,1.05] as const;
export function applausePhase(time: number, person: number, reducedMotion=false) {
  if(reducedMotion||!Number.isFinite(time)) return 0.5;
  const index=((person%8)+8)%8;
  return ((time/applausePeriods[index]+index*0.173)%1+1)%1;
}

const handshakeKeys = [
  [0,0], [0.22,1], [0.42,2], [0.58,3], [0.8,4], [1,5],
] as const;

/** A reversible scroll-scrubbed pose sequence, never an autoplaying video. */
export function handshakePose(progress: number) {
  const q=clamp(progress);
  let index=0;
  while(index<handshakeKeys.length-2&&q>handshakeKeys[index+1][0]) index++;
  const [start,from]=handshakeKeys[index], [end,to]=handshakeKeys[index+1];
  return {
    // These are six independently authored poses, not optically aligned AVIF
    // frames. Select one coherent silhouette; a crossfade creates extra hands
    // when the user stops mid-scrub. Translation/scale stay continuous.
    from, to, blend:(q-start)/(end-start)<0.5?0:1,
    separation:0.28*(1-smooth(q/0.3)),
    opening:q===1?1:clamp((q-0.66)/0.34),
    scale:0.64+smooth(q/0.64)*1.12,
  };
}

export function handshakeCell(frame: number) {
  const index=Math.max(0,Math.min(5,Math.floor(frame)));
  return {x:index%2/2,y:(2-Math.floor(index/2))/3};
}
