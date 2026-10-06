import test from 'node:test';
import assert from 'node:assert/strict';
import {curlFrame,curlVertex,curlCovers} from '../src/components/scene/page-curl-geometry.ts';
test('front arc preserves its length and the fitted sheet reverses deterministically',()=>{
 for(const aspect of [390/844,768/1024,1440/900,1916/1034])for(const q of [.05,.3,.6,.9]){
  const f=curlFrame(q,aspect),ds=.00001;
  for(const angle of [.1,.7,1.5]){
   const s=f.crease+angle*f.radius;
   const a=curlVertex(s*f.nx,s*f.ny,f),b=curlVertex((s+ds)*f.nx,(s+ds)*f.ny,f);
   assert.ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)/ds-1)<.001);
   assert.deepEqual(a,curlVertex(s*f.nx,s*f.ny,curlFrame(q,aspect)));
  }
 }
});
test('the physical mesh starts flat and the free corner follows measured intermediate positions',()=>{
 const aspect=1916/1034,f=curlFrame(0,aspect);
 for(const x of [-aspect,aspect])for(const y of [-1,1])assert.deepEqual(curlVertex(x,y,f),{x,y,z:0,shade:1,backShade:1});
 for(const [step,u,v] of [[4,.735,.477],[8,.634,.060]]){
  const p=curlVertex(aspect,-1,curlFrame(step/17,aspect));
  assert.ok(Math.abs((p.x/aspect+1)/2-u)<.025);
  assert.ok(Math.abs((1-p.y)/2-v)<.03);
 }
});
test('curl starts covered and ends clear at all screen corners',()=>{
 for(const aspect of [.46,.75,1.6,1.85])for(const u of [0,1])for(const v of [0,1]){
  assert.equal(curlCovers(0,aspect,u,v),true);
  assert.equal(curlCovers(1,aspect,u,v),false);
 }
});
