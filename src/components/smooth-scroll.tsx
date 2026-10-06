"use client";
import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { SceneRuntime } from './scene/runtime';
import { createIntroGestureState, reduceIntroGesture, introSnapEase } from './scene/intro-gesture';
import { projectAboutWheelSteps } from './scene/project-about-transition';
import { MENU_SIGNAL_DURATION, monitorMenuTransition, type MenuNavigationRequest } from './scene/menu-navigation';
import { sceneScrollTop, storyProgress, SCROLL_SCREENS } from './scene/runtime';
import { getSceneState, type SceneId } from '@/config/scenes';

gsap.registerPlugin(ScrollTrigger);
export function SmoothScroll({runtime,reducedMotion}:{runtime:RefObject<SceneRuntime>;reducedMotion:boolean}) {
  useEffect(()=>{
    let gesture=createIntroGestureState();
    let lenis:Lenis|null=null;
    let viewportHeight=window.innerHeight;
    let signalTimeline:gsap.core.Timeline|null=null;
    let pending:MenuNavigationRequest|null=null;
    let committed=false;
    let monitorTarget:SceneId|null=null;
    const arbitrate=(deltaX:number,deltaY:number,event:Event)=>{
      // false bypasses Lenis without cancelling the browser's modifier gesture.
      if(event instanceof WheelEvent&&(event.ctrlKey||event.metaKey))return false;
      if(runtime.current.menuSignalActive||monitorTarget!==null){event.preventDefault();return false;}
      if(document.querySelector('.experience')?.classList.contains('is-fallback'))return true;
      const wheelSteps=event instanceof WheelEvent?projectAboutWheelSteps(event.deltaX,event.deltaY,event.deltaMode,(event as WheelEvent & {wheelDeltaY?:number}).wheelDeltaY):0;
      const result=reduceIntroGesture(gesture,{deltaX,deltaY,wheelSteps,time:performance.now(),scroll:window.scrollY,viewportHeight:window.innerHeight,ready:runtime.current.intro>=1,menuOpen:runtime.current.menuOpen});
      gesture=result.state;
      if(result.action.type==='pass')return true;
      event.preventDefault();
      if(result.action.type==='gallery')window.dispatchEvent(new CustomEvent('study-project',{detail:result.action.direction}));
      if(result.action.type==='snap'){
        if(lenis)lenis.scrollTo(result.action.top,{duration:result.action.duration,lock:true,force:true,easing:introSnapEase});
        else window.scrollTo({top:result.action.top,behavior:'instant'});
      }
      if(result.action.type==='aperture'||result.action.type==='curl'){
        // A new detent may retarget or reverse immediately; this is not a lock.
        if(lenis)lenis.scrollTo(result.action.top,{duration:result.action.duration,programmatic:false,force:true,easing:t=>1-Math.pow(1-t,3)});
        else window.scrollTo({top:result.action.top,behavior:'instant'});
      }
      return false;
    };
    if(!reducedMotion)lenis=new Lenis({autoRaf:false,anchors:false,duration:0.9,virtualScroll:({deltaX,deltaY,event})=>arbitrate(deltaX,deltaY,event)});
    const nativeWheel=(event:WheelEvent)=>{
      const unit=event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1;
      arbitrate(event.deltaX*unit,event.deltaY*unit,event);
    };
    if(reducedMotion)window.addEventListener('wheel',nativeWheel,{passive:false});
    const update=(time:number)=>lenis?.raf(time*1000);
    lenis?.on('scroll',ScrollTrigger.update);
    if(lenis)gsap.ticker.add(update);
    const updateProgress=()=>{runtime.current.progress=storyProgress(window.scrollY,window.innerHeight);};
    const trigger=ScrollTrigger.create({start:0,end:()=>SCROLL_SCREENS*window.innerHeight,onUpdate:updateProgress,onRefresh:updateProgress});
    const syncProgress=()=>{
      updateProgress();
      ScrollTrigger.update();
    };
    const commit=()=>{
      if(!pending||committed)return;
      committed=true;
      const top=sceneScrollTop(pending.id,window.innerHeight);
      if(lenis)lenis.scrollTo(top,{immediate:true,force:true});
      else window.scrollTo({top,behavior:'instant'});
      syncProgress();
    };
    const finish=()=>{
      const id=pending?.id;
      pending=null;signalTimeline=null;
      runtime.current.menuSignalActive=false;
      runtime.current.menuSignalProgress=0;
      gesture=createIntroGestureState();
      lenis?.start();
      window.dispatchEvent(new CustomEvent('study-menu-signal',{detail:{active:false,id}}));
    };
    const completeSignal=()=>{signalTimeline?.progress(1);};
    const navigate=(event:Event)=>{
      if(runtime.current.menuSignalActive)return;
      const request=(event as CustomEvent<number|MenuNavigationRequest>).detail;
      const top=typeof request==='number'?request:request.top;
      gesture=createIntroGestureState();
      if(typeof request!=='number'&&request.signal){
        monitorTarget=null;
        pending=request;committed=false;
        // Stop any in-flight monitor/scroll journey before the signal covers it.
        lenis?.scrollTo(window.scrollY,{immediate:true,force:true});
        lenis?.stop();
        runtime.current.menuSignalActive=true;
        runtime.current.menuSignalProgress=0;
        window.dispatchEvent(new CustomEvent('study-menu-signal',{detail:{active:true,id:request.id}}));
        signalTimeline=gsap.timeline({onComplete:finish})
          .to(runtime.current,{menuSignalProgress:1,duration:MENU_SIGNAL_DURATION,ease:'none'},0)
          .call(commit,[],MENU_SIGNAL_DURATION*.5);
        return;
      }
      if(typeof request!=='number'&&request.origin==='menu'&&!document.querySelector('.experience')?.classList.contains('is-fallback')){
        // Repeated clicks do not restart the same journey. A reverse click uses
        // the live scroll position with the same curve, even before scene handoff.
        if(monitorTarget===request.id)return;
        const from=monitorTarget??getSceneState(storyProgress(window.scrollY,window.innerHeight)).scene.id;
        const journey=monitorMenuTransition(from,request.id,window.innerHeight);
        if(journey){
          // Cancel a reversal even when no animation frame has moved yet; Lenis
          // otherwise treats the current position as an already-reached target.
          if(monitorTarget!==null){lenis?.stop();lenis?.start();}
          monitorTarget=request.id;
          if(lenis)lenis.scrollTo(journey.top,{duration:journey.duration,easing:introSnapEase,force:true,lock:true,onComplete:()=>{monitorTarget=null;}});
          else {window.scrollTo({top:journey.top,behavior:'instant'});monitorTarget=null;}
          return;
        }
      }
      monitorTarget=null;
      if(lenis)lenis.scrollTo(top,{duration:1.15,force:true,lock:true});
      else window.scrollTo({top,behavior:'instant'});
    };
    window.addEventListener('study-navigate',navigate);
    window.addEventListener('study-navigation-cancel',completeSignal);
    const blockKey=(event:KeyboardEvent)=>{
      if((runtime.current.menuSignalActive||monitorTarget!==null)&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))event.preventDefault();
    };
    const blockTouch=(event:TouchEvent)=>{if((runtime.current.menuSignalActive||monitorTarget!==null)&&event.touches.length===1)event.preventDefault();};
    const visibility=()=>{if(document.hidden)completeSignal();};
    window.addEventListener('keydown',blockKey);
    window.addEventListener('touchmove',blockTouch,{passive:false});
    document.addEventListener('visibilitychange',visibility);
    const resize=()=>{
      monitorTarget=null;
      const position=window.scrollY/Math.max(1,viewportHeight);
      viewportHeight=window.innerHeight;gesture=createIntroGestureState();
      lenis?.resize();
      if(lenis)lenis.scrollTo(position*viewportHeight,{immediate:true,force:true});
      ScrollTrigger.refresh();
    };
    window.addEventListener('resize',resize);
    const refresh=()=>{lenis?.resize();ScrollTrigger.refresh();syncProgress();};
    window.addEventListener('study-layout-change',refresh);
    document.fonts.ready.then(refresh);
    // The trigger's initial refresh supplies restored scroll progress as well.
    trigger.refresh();
    return()=>{completeSignal();signalTimeline?.kill();trigger.kill();gsap.ticker.remove(update);lenis?.off('scroll',ScrollTrigger.update);lenis?.destroy();window.removeEventListener('wheel',nativeWheel);window.removeEventListener('study-navigate',navigate);window.removeEventListener('study-navigation-cancel',completeSignal);window.removeEventListener('keydown',blockKey);window.removeEventListener('touchmove',blockTouch);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);window.removeEventListener('study-layout-change',refresh);};
  },[reducedMotion,runtime]);
  return null;
}
