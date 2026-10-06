import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_SIGNAL_DURATION, shouldUseMenuSignal, monitorMenuTransition } from '../src/components/scene/menu-navigation.ts';
import { createIntroGestureState, reduceIntroGesture } from '../src/components/scene/intro-gesture.ts';

test('both monitor menu routes keep the real wheel endpoint and duration at every viewport',()=>{
  for(const height of [700,844,900,1024]){
    for(const [from,to,scroll,deltaY] of [['hero','projects',0,120],['projects','hero',1.42*height,-120]] as const){
      const action=reduceIntroGesture(createIntroGestureState(),{deltaX:0,deltaY,time:0,scroll,viewportHeight:height,ready:true,menuOpen:false}).action;
      assert.equal(action.type,'snap');
      if(action.type==='snap')assert.deepEqual(monitorMenuTransition(from,to,height),{top:action.top,duration:action.duration});
    }
  }
});

test('monitor timing does not apply to same-section or signal menu routes',()=>{
  for(const from of ['hero','projects','about-us','contact'])for(const to of ['hero','projects','about-us','contact']){
    if((from==='hero'&&to==='projects')||(from==='projects'&&to==='hero'))continue;
    assert.equal(monitorMenuTransition(from,to,900),null);
  }
});

test('menu signal covers all cross-section pairs except the physical monitor journey',()=>{
  const sections=['hero','projects','about-us','contact'];
  const exempt=new Set(['hero:projects','projects:hero']);
  let enabled=0;
  for(const from of sections)for(const to of sections){
    const expected=from!==to&&!exempt.has(`${from}:${to}`);
    assert.equal(shouldUseMenuSignal(from,to),expected,`${from} → ${to}`);
    if(expected)enabled++;
  }
  assert.equal(enabled,10);
  assert.equal(MENU_SIGNAL_DURATION,1.2);
});

test('legacy blue and tie targets now belong to Contact for menu decisions',()=>{
  for (const legacy of ['golden-tie-reveal', 'golden-tie']) {
    assert.equal(shouldUseMenuSignal(legacy,'about-us'),true);
    assert.equal(shouldUseMenuSignal(legacy,'contact'),false);
    assert.equal(shouldUseMenuSignal(legacy,'hero'),true);
  }
});
