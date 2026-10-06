"use client";

import { useEffect, useRef } from 'react';
import { createRoot, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { createScenePipeline } from './scene-pipeline';
import type { SceneCanvasProps } from './types';

type PipelineType = ReturnType<typeof createScenePipeline>;
function Pipeline({ runtime, onStatus, onPaperActionBounds }: Pick<SceneCanvasProps, 'runtime' | 'onStatus' | 'onPaperActionBounds'>) {
  const { gl, size } = useThree();
  const pipeline = useRef<PipelineType | null>(null);
  const announced = useRef(false);
  useEffect(() => {
    const renderer = gl as unknown as THREE.WebGPURenderer;
    pipeline.current = createScenePipeline(renderer, size.width, size.height);
    const current = pipeline.current;
    const debugWindow = window as Window & { __sceneDiagnostics?: PipelineType['diagnostics'] };
    debugWindow.__sceneDiagnostics = current.diagnostics;
    return () => { current.dispose(); pipeline.current=null; delete debugWindow.__sceneDiagnostics; onPaperActionBounds(null); };
    // Resize is handled separately without rebuilding GPU resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);
  useEffect(() => { pipeline.current?.resize(size.width,size.height); }, [size.width,size.height]);
  useFrame((_, delta) => {
    try {
      pipeline.current?.render(runtime.current,delta);
      onPaperActionBounds(pipeline.current?.paperActionBounds ?? null);
      if(pipeline.current?.isReady && !announced.current) {
        const renderer = gl as unknown as THREE.WebGPURenderer;
        const backend=renderer.backend as {isWebGPUBackend?:boolean};
        announced.current=true; onStatus(backend.isWebGPUBackend?'webgpu':'webgl2');
      }
    } catch(error) { console.error('Scene renderer failed:',error); onStatus('fallback'); }
  },1);
  return null;
}

export default function SceneCanvas({ onStatus, runtime, onPaperActionBounds }: SceneCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element=host.current;
    if(!element) return;
    const requested=new URLSearchParams(window.location.search).get('renderer');
    if(requested==='none') { onStatus('fallback'); return; }
    let cancelled=false, ready=false;
    let renderTick:((time:number)=>void)|undefined;
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-hidden','true'); canvas.style.cssText='width:100%;height:100%;display:block';
    element.append(canvas);
    const root=createRoot(canvas);
    let renderer:THREE.WebGPURenderer|undefined;
    const size=()=>({width:element.clientWidth,height:element.clientHeight,top:0,left:0});
    const observer=new ResizeObserver(()=>{ if(ready&&!cancelled) void root.configure({size:size(),frameloop:'never',dpr:[1,1.5]}); });
    const lost=(event:Event)=>{event.preventDefault();onStatus('fallback');};
    canvas.addEventListener('webglcontextlost',lost);
    async function init() {
      try {
        await Promise.all([document.fonts.load('500 48px "STIX Two Text"'),document.fonts.load('italic 700 32px "STIX Two Text"'),document.fonts.load('400 48px "VT323"')]);
        if(cancelled) {root.unmount();return;}
        await root.configure({
          gl:async()=>{
            renderer=new THREE.WebGPURenderer({canvas,antialias:true,alpha:false,forceWebGL:requested==='webgl'});
            await renderer.init(); renderer.setClearColor('#09090b');
            // Match Fiber 9's configure default; all layers share the final composite.
            renderer.toneMapping=THREE.ACESFilmicToneMapping;
            return renderer;
          },
          size:size(),dpr:[1,1.5],frameloop:'never',
        });
        if(cancelled) {root.unmount();return;}
        const store=root.render(<Pipeline runtime={runtime} onStatus={onStatus} onPaperActionBounds={onPaperActionBounds}/>);
        // GSAP already owns Lenis and the timelines. Fiber's manual clock uses seconds.
        renderTick=(time:number)=>store.getState().advance(time,true);
        gsap.ticker.add(renderTick);
        ready=true;observer.observe(element!);
      } catch(error) {
        console.error('GPU initialization failed:',error);
        renderer?.dispose();root.unmount();canvas.remove();
        if(!cancelled)onStatus('fallback');
      }
    }
    void init();
    return()=>{cancelled=true;observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);if(renderTick)gsap.ticker.remove(renderTick);if(ready)root.unmount();canvas.remove();};
  },[onStatus,runtime,onPaperActionBounds]);
  return <div ref={host} className="scene-canvas" data-testid="scene-canvas"/>;
}
