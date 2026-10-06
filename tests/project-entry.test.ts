import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleProjectEntry, type ProjectEntry } from '../src/components/scene/project-entry.ts';

const state=():ProjectEntry=>({phase:0,camera:0,depth:0,turns:0,caption:0,offsetX:0,offsetY:0,visiblePanels:0});
test('the film approaches from depth and completes its turn after the monitor fills the view',()=>{
  const out=state();let lastDepth=-Infinity,lastTurn=-Infinity,monitorFilled=false;
  for(let i=0;i<=100;i++){
    sampleProjectEntry(i/100,false,out);
    assert.ok(out.depth>=lastDepth&&out.turns>=lastTurn,'entry never rises/reverses along its depth or phase path');
    if(out.camera===1&&out.turns<-.5&&out.depth<0)monitorFilled=true;
    lastDepth=out.depth;lastTurn=out.turns;
  }
  assert.ok(monitorFilled,'the inner film still approaches/turns after the outer monitor dolly ends');
  assert.equal(out.depth,0);assert.equal(Math.abs(out.turns),0);assert.equal(out.caption,1);
});
test('scrubbing backward gives the same depth/turn state without accumulated animation',()=>{
  const forward=Array.from({length:21},(_,i)=>({...sampleProjectEntry(i/20,false,state())}));
  const out=state();
  for(let i=20;i>=0;i--)assert.deepEqual(sampleProjectEntry(i/20,false,out),forward[i]);
  assert.equal(sampleProjectEntry(.5,false,out),out,'reuse the frame object');
});
test('reduced motion presents the settled film immediately',()=>{
  for(const p of [0,.2,.6,1])assert.deepEqual(sampleProjectEntry(p,true,state()),{phase:1,camera:1,depth:0,turns:0,caption:1,offsetX:0,offsetY:0,visiblePanels:11});
});
