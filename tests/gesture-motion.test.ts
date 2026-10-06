import assert from 'node:assert/strict';
import test from 'node:test';
import { applausePhase, applausePeriods, handshakeCell, handshakePose } from '../src/components/scene/gesture-motion.ts';

test('applause advances while scroll is stationary, has individual phases, and freezes for reduced motion',()=>{
  for(let index=0;index<8;index++) {
    assert.notEqual(applausePhase(1,index),applausePhase(1.2,index));
    assert.ok(Math.abs(applausePhase(1,index)-applausePhase(1+applausePeriods[index],index))<1e-12);
    assert.equal(applausePhase(200,index,true),0.5);
  }
  assert.equal(new Set(Array.from({length:8},(_,i)=>applausePhase(1,i))).size,8);
});

test('handshake approaches with open hands before clasp and only then opens the contact scene',()=>{
  assert.deepEqual([handshakePose(0).from,handshakePose(0).separation],[0,0.28]);
  assert.equal(handshakePose(0.42).to,2);
  assert.equal(handshakePose(0.58).to,3);
  assert.equal(handshakePose(0.65).opening,0);
  assert.ok(handshakePose(0.8).opening>0);
  assert.equal(handshakePose(1).opening,1);
});

test('handshake scrub is history independent in both directions and samples only valid atlas cells',()=>{
  const samples=Array.from({length:101},(_,i)=>i/100);
  const forward=samples.map(handshakePose);
  assert.deepEqual(samples.toReversed().map(handshakePose).toReversed(),forward);
  for(const pose of forward) {
    for(const frame of [pose.from,pose.to]) {
      const cell=handshakeCell(frame);
      assert.ok(cell.x>=0&&cell.x+0.5<=1&&cell.y>=0&&cell.y+1/3<=1);
    }
    assert.ok(pose.blend===0||pose.blend===1, 'a held scroll position displays one coherent photographic silhouette');
  }
});
