/** Boundary holds measured from aboutus-gecisi.mp4, excluding its taskbar.
 * Values are the lower tangent's left-edge height in screen-height units.
 * The last clipped holds are extrapolated; no wheel telemetry exists. */
const BOUNDARY = [1.60,1.441,1.323,1.203,1.125,1.026,.936,.848,.753,.69,.608,.522,.441,.353,.27,.18,.09,-.035];
const REFERENCE_ASPECT = 1916 / 1034;
const SLOPE = .282;
const NX = SLOPE / Math.hypot(1, SLOPE);
const NY = -1 / Math.hypot(1, SLOPE);
function profile(q:number,values:readonly (readonly [number,number])[]) {
  const i=Math.max(1,values.findIndex(v=>v[0]>=q));
  const a=values[i-1],b=values[i];
  return a[1]+(b[1]-a[1])*Math.min(1,Math.max(0,(q-a[0])/(b[0]-a[0])));
}

export function curlFrame(progress: number, aspect: number) {
  const q=Math.max(0,Math.min(1,progress));
  const step=q*17,index=Math.min(16,Math.floor(step)),t=step-index;
  const b=BOUNDARY[index]+(BOUNDARY[index+1]-BOUNDARY[index])*t;
  // Keep the diagonal at the same angle in pixels; portrait covers its own
  // complete diagonal rather than cropping a landscape-sized sheet.
  const extent=NX*aspect-NY;
  const referenceExtent=NX*REFERENCE_ASPECT-NY;
  const edge=(2*b-1-SLOPE*REFERENCE_ASPECT)/Math.hypot(1,SLOPE)*extent/referenceExtent;
  const size=Math.min(1,Math.sqrt(aspect/REFERENCE_ASPECT));
  const radius=profile(q,[[0,.13],[4/17,.225],[8/17,.687],[12/17,.59],[1,.42]])*size;
  const fan=profile(q,[[0,0],[4/17,.66],[8/17,.80],[12/17,.30],[1,0]])*size;
  return { crease:edge-radius,radius,nx:NX,ny:NY,fan,maxDistance:extent-edge+radius };
}

/** Isometric cylindrical bend: only the normal coordinate bends, never UVs.
 * The lifted free end fans along the crease to follow the measured corner;
 * this is a fitted deformation, not a recovered physical reference model. */
export function curlVertex(x:number,y:number,frame:ReturnType<typeof curlFrame>) {
  const {nx,ny,crease,radius}=frame;
  const d=nx*x+ny*y-crease;
  if(d<=0)return {x,y,z:0,shade:1,backShade:1};
  const angle=Math.min(Math.PI,d/radius);
  const normal=crease+radius*Math.sin(angle)-Math.max(0,d-Math.PI*radius);
  const displacement=normal-(nx*x+ny*y);
  const t=Math.min(1,Math.max(0,(d-radius*Math.PI/2)/Math.max(.001,frame.maxDistance-radius*Math.PI/2)));
  const fan=frame.fan*t*t*(3-2*t);
  return {x:x+nx*displacement+ny*fan,y:y+ny*displacement-nx*fan,z:radius*(1-Math.cos(angle)),
    shade:1-.60*Math.sin(angle)**4,
    backShade:.30+.92*Math.sin(Math.min(1,t*1.3)*Math.PI/2)};
}

/** At a header pixel, choose the ink for the actual exposed surface. */
export function curlCovers(progress:number,aspect:number,u:number,v:number) {
  if(progress<=0)return true;if(progress>=1)return false;
  const f=curlFrame(progress,aspect);
  return f.nx*((u-.5)*2*aspect)+f.ny*((.5-v)*2) <= f.crease+f.radius;
}
