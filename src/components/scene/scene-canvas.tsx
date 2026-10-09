"use client";

import { useEffect, useRef } from 'react';
import { createRoot, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { createScenePipeline } from './scene-pipeline';
import { createSceneLifecycle, createSceneResizeQueue, disposeUnownedSceneRenderer } from './scene-lifecycle';
import type { SceneCanvasProps } from './types';

type PipelineType = ReturnType<typeof createScenePipeline>;
type SceneLifecycle = ReturnType<typeof createSceneLifecycle>;
function Pipeline({ runtime, onStatus, lifecycle, fontsReady }: SceneCanvasProps & { lifecycle: SceneLifecycle; fontsReady: Promise<unknown> }) {
  const { gl, size } = useThree();
  const pipeline = useRef<PipelineType | null>(null);
  const announced = useRef(false);
  useEffect(() => {
    const renderer = gl as unknown as THREE.WebGPURenderer;
    const current = lifecycle.run(() => createScenePipeline(renderer, size.width, size.height, fontsReady));
    if (!current) return;
    pipeline.current = current;
    announced.current = false;
    const debugWindow = window as Window & { __sceneDiagnostics?: PipelineType['diagnostics'] };
    debugWindow.__sceneDiagnostics = current.diagnostics;
    return () => {
      pipeline.current = null;
      if (debugWindow.__sceneDiagnostics === current.diagnostics) delete debugWindow.__sceneDiagnostics;
      try { current.dispose(); } catch (error) { console.warn('Scene cleanup failed:', error); }
    };
    // Resize is handled separately without rebuilding GPU resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, fontsReady]);
  useEffect(() => { lifecycle.run(() => pipeline.current?.resize(size.width,size.height)); }, [lifecycle,size.width,size.height]);
  useFrame((_, delta) => {
    lifecycle.run(() => {
      pipeline.current?.render(runtime.current,delta);
      if(pipeline.current?.isReady && !announced.current) {
        const renderer = gl as unknown as THREE.WebGPURenderer;
        const backend=renderer.backend as {isWebGPUBackend?:boolean};
        announced.current=true; onStatus(backend.isWebGPUBackend?'webgpu':'webgl2');
      }
    });
  },1);
  return null;
}

export default function SceneCanvas({ onStatus, runtime }: SceneCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element=host.current;
    if(!element) return;
    const requested=new URLSearchParams(window.location.search).get('renderer');
    if(requested==='none') { onStatus('fallback'); return; }
    let stopped = false;
    let renderTick:((time:number)=>void)|undefined;
    let resizeQueue: ReturnType<typeof createSceneResizeQueue> | undefined;
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-hidden','true'); canvas.style.cssText='width:100%;height:100%;display:block';
    element.append(canvas);
    const root=createRoot(canvas);
    let renderer:THREE.WebGPURenderer|undefined;
    const lifecycle = createSceneLifecycle(error => {
      console.error('Scene renderer failed:', error);
      stop();
      onStatus('fallback');
    });
    const size=()=>({width:element.clientWidth,height:element.clientHeight,top:0,left:0});
    const observer=new ResizeObserver(()=>{ resizeQueue?.request(size()); });
    function stop() {
      if (stopped) return;
      stopped = true;
      lifecycle.dispose();
      observer.disconnect();
      resizeQueue?.dispose();
      if (renderTick) gsap.ticker.remove(renderTick);
      // Fiber owns a renderer returned by its factory, including a pending configure.
      // It flushes Pipeline cleanup before disposing that renderer.
      try { root.unmount(); } catch (error) { console.warn('Canvas cleanup failed:', error); }
      canvas.remove();
    }
    async function init() {
      try {
        // Font rasterization waits for the real faces, while independent model,
        // image and video requests can start as soon as the renderer is mounted.
        const fontsReady = Promise.all([document.fonts.load('500 48px "STIX Two Text"'),document.fonts.load('italic 700 32px "STIX Two Text"'),document.fonts.load('400 48px "VT323"')]);
        void fontsReady.catch(lifecycle.fail);
        if(!lifecycle.active) return;
        const initialSize = size();
        await root.configure({
          gl:async()=>{
            renderer=new THREE.WebGPURenderer({canvas,antialias:true,alpha:false,forceWebGL:requested==='webgl'});
            const defaultDeviceLost = renderer.onDeviceLost.bind(renderer);
            renderer.onDeviceLost = info => {
              if (!lifecycle.active) return;
              // Preserve Three's internal lost-device flag for either backend.
              defaultDeviceLost(info);
              lifecycle.fail(new Error(`${info.api} device lost: ${info.message}`));
            };
            try {
              await renderer.init(); renderer.setClearColor('#09090b');
              // Match Fiber 9's configure default; all layers share the final composite.
              renderer.toneMapping=THREE.ACESFilmicToneMapping;
              return renderer;
            } catch (error) {
              renderer.onDeviceLost = () => {};
              try { await disposeUnownedSceneRenderer(renderer); }
              catch (cleanupError) { console.warn('Renderer initialization cleanup failed:', cleanupError); }
              throw error;
            }
          },
          size:initialSize,dpr:[1,1.5],frameloop:'never',
        });
        if(!lifecycle.active) return;
        const store=root.render(<Pipeline runtime={runtime} onStatus={onStatus} lifecycle={lifecycle} fontsReady={fontsReady}/>);
        if(!lifecycle.active) return;
        // GSAP already owns Lenis and the timelines. Fiber's manual clock uses seconds.
        renderTick=(time:number)=>{ lifecycle.run(() => store.getState().advance(time,true)); };
        gsap.ticker.add(renderTick);
        resizeQueue = createSceneResizeQueue(initialSize,
          next => root.configure({size:{...next,top:0,left:0},frameloop:'never',dpr:[1,1.5]}),
          lifecycle.fail);
        observer.observe(element!);
      } catch(error) {
        lifecycle.fail(error);
      }
    }
    void init();
    return stop;
  },[onStatus,runtime]);
  return <div ref={host} className="scene-canvas" data-testid="scene-canvas"/>;
}
