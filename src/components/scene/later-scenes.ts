import * as THREE from "three/webgpu";
import { attribute, color, mix, texture, uniform, uv, vec2 } from "three/tsl";
import type { SceneId } from "@/config/scenes";
import type { SceneRuntime } from "./runtime";
import { createCanvasUI } from "./canvas-ui";
import { contactLayout } from "./contact-layout";
import { createPaperUI } from "./paper-ui";
import { paperScrollOffset } from "./paper-action";
import { curlFrame, curlVertex } from "./page-curl-geometry";
import { ABOUT_CURL_START, sampleCurlProgress } from "@/lib/about-curl";
import { createResourceScope } from "./resource-scope";

type LaterId = "contact";
const clamp = (n: number) => THREE.MathUtils.clamp(n, 0, 1);

/** Dependency-ordered later scenes. The calling pipeline owns the final header/CRT pass. */
export function createLaterScenes(renderer: THREE.WebGPURenderer, width: number, height: number, deferred = false) {
  const scope = createResourceScope();
  try { return buildLaterScenes(renderer, width, height, scope, deferred); }
  catch (error) { scope.dispose(); throw error; }
}

function buildLaterScenes(renderer: THREE.WebGPURenderer, width: number, height: number, scope: ReturnType<typeof createResourceScope>, deferred: boolean) {
  let w = width, h = height, aspect = w / h, disposed = false;
  const own = scope.own;
  const sourceTarget = own(new THREE.RenderTarget(w, h, { depthBuffer: true }));
  const nextTarget = own(new THREE.RenderTarget(w, h, { depthBuffer: true }));
  const paper = own(createPaperUI(w, h, true));
  let lastCurl = -1;
  const ids: LaterId[] = ["contact"];
  const ui = Object.fromEntries(ids.map(id => [id, own(createCanvasUI(w, h, true))])) as Record<LaterId, ReturnType<typeof createCanvasUI>>;
  const uiKeys = new Map<LaterId, string>();
  const plane = own(new THREE.PlaneGeometry(2, 2));
  const uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20); uiCamera.position.z = 5;
  const flatCamera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.01, 20); flatCamera.position.z = 6;
  const blueBackground = new THREE.Scene();
  const blueMaterial = own(new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false }));
  // Video holds have a neutral near-black upper half and blue concentrated low.
  blueMaterial.colorNode = mix(color("#302769"), color("#282828"), uv().y.smoothstep(0,0.41));
  blueBackground.add(new THREE.Mesh(plane, blueMaterial));
  const copyMaterial = own(new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false }));
  const copyQuad = own(new THREE.QuadMesh(copyMaterial));
  const uiScenes = Object.fromEntries(ids.map(id => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(plane, own(new THREE.MeshBasicNodeMaterial({ map: ui[id].texture, transparent: true, depthTest: false, depthWrite: false }))));
    return [id, scene];
  })) as Record<LaterId, THREE.Scene>;
  const diagnostics = { passes: [] as string[], scene: "about-us" as SceneId, progress: 0, curl: 0, assetErrors: [] as string[], proxies: ["video-calibrated intact page curl"] };

  function drawUI(id: LaterId, progress: number, runtime: SceneRuntime) {
    const layout = contactLayout(w, h, progress, runtime.storyHeight, runtime.visibleHeight);
    // The virtual scroll range is longer than the contact artwork's travel.
    // Once its physical offset stops, keep the existing bitmap and GPU upload.
    const scrollKey = layout.offset === layout.travel ? 'settled' : Math.round(progress * 500);
    const key = `${w}/${h}/${runtime.storyHeight}/${runtime.visibleHeight}/${scrollKey}`;
    if (uiKeys.get(id) !== key) {
      ui[id].draw({ mode: id, sceneProgress: progress, storyHeight: runtime.storyHeight, visibleHeight: runtime.visibleHeight, bootProgress: 1, projectIndex: runtime.projectIndex, headerVisible: false });
      uiKeys.set(id, key);
    }
    renderer.autoClear = false; renderer.render(uiScenes[id], uiCamera);
  }
  function start(target: THREE.RenderTarget, scene = blueBackground) {
    renderer.setRenderTarget(target); renderer.autoClear = true; renderer.render(scene, uiCamera); renderer.autoClear = false;
  }
  function copy(input: THREE.RenderTarget, output: THREE.RenderTarget) {
    renderer.setRenderTarget(output); renderer.autoClear = true; copyMaterial.map = input.texture; copyQuad.render(renderer); renderer.autoClear = false;
  }
  // One continuous sheet. Front/back share positions and unchanged UVs.
  const curlGeometry = own(new THREE.PlaneGeometry(2, 2, 160, 100));
  const curlOriginal = curlGeometry.attributes.position.array.slice();
  // Reuse one sample across all 16,261 vertices instead of allocating an
  // object per point on every animated frame. The deformation math is intact.
  const curlSample = { x: 0, y: 0, z: 0, shade: 1, backShade: 1 };
  const shades=new THREE.BufferAttribute(new Float32Array(curlGeometry.attributes.position.count),1).setUsage(THREE.DynamicDrawUsage);
  const backShades=new THREE.BufferAttribute(new Float32Array(curlGeometry.attributes.position.count),1).setUsage(THREE.DynamicDrawUsage);
  curlGeometry.setAttribute('curlShade',shades);curlGeometry.setAttribute('curlBackShade',backShades);
  (curlGeometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  const curlScene = new THREE.Scene();
  const front=own(new THREE.MeshBasicNodeMaterial({side:THREE.FrontSide}));
  front.colorNode=texture(sourceTarget.texture,uv().flipY()).rgb.mul(attribute('curlShade','float'));
  const back=own(new THREE.MeshBasicNodeMaterial({side:THREE.BackSide}));
  back.colorNode=mix(color('#f5f1d8'),texture(sourceTarget.texture,uv().flipY()).rgb,.15).mul(attribute('curlBackShade','float'));
  for(const material of [front,back]){const sheet=new THREE.Mesh(curlGeometry,material);sheet.frustumCulled=false;curlScene.add(sheet);}
  const paperScene = new THREE.Scene();
  const paperWindow = uniform(new THREE.Vector2(1, 0));
  const paperMaterial = own(new THREE.MeshBasicNodeMaterial({ depthTest: false }));
  // Node material UVs are explicit: mutable Texture.repeat/offset was cached by
  // the backend and left all later scroll stops on the first viewport.
  paperMaterial.colorNode = texture(paper.texture, vec2(uv().x, uv().y.mul(paperWindow.x).add(paperWindow.y))).rgb;
  paperScene.add(new THREE.Mesh(plane, paperMaterial));

  function renderPaper(scroll: number, target: THREE.RenderTarget) {
    const visible = Math.min(1, h / Math.max(h, paper.height));
    const offset = paperScrollOffset(paper.height, h, scroll);
    paperWindow.value.set(visible, (Math.max(0, paper.height - h) - offset) / Math.max(h, paper.height));
    renderer.setRenderTarget(target); renderer.autoClear = true; renderer.render(paperScene, uiCamera);
    diagnostics.passes.push("about-paper");
  }
  function renderContact(p: number, runtime: SceneRuntime, target: THREE.RenderTarget) {
    start(target); drawUI("contact", p, runtime); diagnostics.passes.push("contact");
  }
  function updateCurl(q:number){
    if(q===lastCurl)return;lastCurl=q;
    const positions=curlGeometry.attributes.position,f=curlFrame(q,aspect);
    for(let i=0;i<positions.count;i++){
      const v=curlVertex(curlOriginal[i*3]*aspect,curlOriginal[i*3+1],f,curlSample);
      positions.setXYZ(i,v.x,v.y,v.z+.01);shades.setX(i,v.shade);backShades.setX(i,v.backShade);
    }
    positions.needsUpdate=true;shades.needsUpdate=true;backShades.needsUpdate=true;
  }
  function render(id:SceneId,progress:number,runtime:SceneRuntime,outputTarget:THREE.RenderTarget){
    if(disposed)return;
    const oldTarget=renderer.getRenderTarget(),oldAutoClear=renderer.autoClear;
    const p=clamp(progress);
    diagnostics.passes.length=0;diagnostics.scene=id;diagnostics.progress=p;diagnostics.curl=0;
    try{
      if(id==='about-us'){
        const q=sampleCurlProgress(p);diagnostics.curl=q;
        if(q>0){
          renderContact(0,runtime,nextTarget);
          if(runtime.reducedMotion){if(q<.5)renderPaper(1,outputTarget);else copy(nextTarget,outputTarget);diagnostics.passes.push('reduced-motion-cut');}
          else{renderPaper(1,sourceTarget);copy(nextTarget,outputTarget);if(q<1){updateCurl(q);renderer.render(curlScene,flatCamera);}diagnostics.passes.push('intact-page-curl');}
        }else renderPaper(p/ABOUT_CURL_START,outputTarget);
      }else if(id==='contact')renderContact(p,runtime,outputTarget);
      else throw new Error(`Later scene renderer cannot render ${id}`);
    }finally{renderer.setRenderTarget(oldTarget);renderer.autoClear=oldAutoClear;}
  }
  function resize(nextWidth: number, nextHeight: number) {
    w = Math.max(1, nextWidth); h = Math.max(1, nextHeight); aspect = w / h; lastCurl=-1;
    const dpr = Math.min(renderer.getPixelRatio(), 1.5);
    for (const target of [sourceTarget, nextTarget]) target.setSize(Math.round(w * dpr), Math.round(h * dpr));
    flatCamera.left = -aspect; flatCamera.right = aspect; flatCamera.updateProjectionMatrix();
    paper.resize(w, h); ids.forEach(id => ui[id].resize(w, h)); uiKeys.clear();
  }
  resize(w, h);
  let started = false, settled = false;
  let resolveReady: () => void, rejectReady: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  function load() {
    if (started || disposed) return ready;
    started = true;
    void Promise.all([paper.load(), ui.contact.preloadPortrait()]).then(() => {
      if (!settled) { settled = true; resolveReady(); }
    }).catch((error: unknown) => {
      if (!settled) { settled = true; rejectReady(error); }
    });
    return ready;
  }
  if (!deferred) void load();
  return { render, resize, ready, load, diagnostics, dispose() {
    if (disposed) return; disposed = true;
    scope.dispose();
    if (!settled) { settled = true; resolveReady(); }
    for (const scene of [curlScene, paperScene, blueBackground, ...Object.values(uiScenes)]) scene.clear();
  } };
}
