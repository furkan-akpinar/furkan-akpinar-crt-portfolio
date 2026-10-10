import * as THREE from 'three/webgpu';
import { portfolio } from '@/content/portfolio';
import { PROJECT_FILM } from './project-ring';

/** Preserve the artwork's full composition within the approved film aperture. */
export function projectImagePlacement(sourceWidth:number,sourceHeight:number,cropRight:number,targetWidth:number,targetHeight:number) {
  const width=Math.max(1,sourceWidth-Math.max(0,cropRight));
  const height=Math.max(1,sourceHeight);
  const scale=Math.min(targetWidth/width,targetHeight/height);
  return {sourceWidth:width,sourceHeight:height,width:width*scale,height:height*scale,x:(targetWidth-width*scale)/2,y:(targetHeight-height*scale)/2};
}

export function projectImageCandidates(image:string,width:number) {
  const base=image.replace(/\.1536\.jpg$/, '');
  const size=width<=1024?1024:1536;
  return ['avif','webp','jpg'].map(format=>`${base}.${size}.${format}`);
}

/** Load once, fit without stretching, and share these seven textures across all film slots. */
export function createProjectImages(width=1536,deferred=false) {
  const height=Math.round(width/PROJECT_FILM.mediaAspect);
  let disposed=false,settled=false,started=false;
  let failure:Error|null=null;
  let resolveReady:()=>void,rejectReady:(reason:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const averageColors=portfolio.projects.map(project=>new THREE.Color(project.color));
  const diagnostics={source:'user-project-screenshots',width,height,readyCount:0,total:portfolio.projects.length,visible:[] as number[],sources:[] as string[],fallbackCount:0,error:null as string|null};
  const canvases:HTMLCanvasElement[]=[];
  const textures:THREE.CanvasTexture[]=[];
  const pendingLoads=new Set<()=>void>();
  function fail(error:Error){
    if(disposed||settled)return;
    failure=error;diagnostics.error=error.message;settled=true;
    for(const cancel of pendingLoads)cancel();
    rejectReady(error);
  }
  function loadImage(index:number) {
    const project=portfolio.projects[index];
    const canvas=canvases[index],map=textures[index];
    const context=canvas.getContext('2d')!;
    return new Promise<void>((resolve,reject)=>{
    const image=new Image();
    // The browser selects a supported format before requesting any poster.
    // An off-DOM picture gives the canvas loader the same native negotiation
    // as HTML images, without downloading feature probes or multiple variants.
    const candidates=projectImageCandidates(project.image,width);
    const picture=document.createElement('picture');
    const sources:HTMLSourceElement[]=[];
    for(const [index,format] of ['avif','webp'].entries()){
      const source=document.createElement('source');
      source.type=`image/${format}`;source.srcset=candidates[index];
      sources.push(source);
      picture.append(source);
    }
    picture.append(image);
    // These off-DOM images gate the intro, so they must not sit behind all
    // desktop model textures at the browser's default image priority.
    image.fetchPriority='high';
    let finished=false;
    const release=(clearSource=true)=>{
      finished=true;clearTimeout(timeout);
      image.onload=null;image.onerror=null;
      // Clear fallback src before detaching from picture. WebKit otherwise
      // starts downloading that JPEG after the selected WebP has already loaded.
      if(clearSource){image.removeAttribute('src');picture.replaceChildren();}
      pendingLoads.delete(cancel);
    };
    const cancel=()=>{if(finished)return;release();resolve();};
    pendingLoads.add(cancel);
    image.onload=()=>{
      if(finished)return;
      if(disposed||failure){cancel();return;}
      try {
        const fit=projectImagePlacement(project.sourceWidth,project.sourceHeight,project.cropRight,width,height);
        const sourceWidth=image.naturalWidth*(fit.sourceWidth/project.sourceWidth);
        context.fillStyle='#050507';context.fillRect(0,0,width,height);
        context.drawImage(image,0,0,sourceWidth,image.naturalHeight,fit.x,fit.y,fit.width,fit.height);
        map.needsUpdate=true;
        // Samples come from the original artwork, so codec rounding does not
        // change the accepted screen/ground color transition.
        const [red,green,blue]=project.averageColor;
        averageColors[index].setRGB(red,green,blue,THREE.SRGBColorSpace);
        diagnostics.sources[index]=image.currentSrc||image.src;
        diagnostics.readyCount++;
        release();resolve();
      }catch(error){release();reject(error);}
    };
    image.onerror=()=>{
      if(finished)return;
      const failedSource=image.currentSrc||image.src;
      const failedIndex=candidates.findIndex(candidate=>failedSource.endsWith(candidate));
      if(failedIndex>=0&&failedIndex<candidates.length-1){
        // A decoder/network failure can still fall back even when the browser
        // advertises support. The same request budget bounds the whole attempt.
        diagnostics.fallbackCount++;
        const selected=sources.find(source=>source.srcset===candidates[failedIndex]);
        if(selected){
          // Change the selected source in place. Detaching a failed picture
          // image makes WebKit retry its old source or fetch the JPEG twice.
          selected.srcset=candidates[failedIndex+1];
          selected.type=failedIndex===0?'image/webp':'image/jpeg';
        }else image.src=candidates[failedIndex+1];
        return;
      }
      // The failed request has settled. Mutating its sources here can restart
      // it in WebKit; clear callbacks and let the unreferenced nodes be collected.
      release(false);reject(new Error(`Proje görseli yüklenemedi: ${project.image}`));
    };
    // Browser queue time counts too: the desktop 4K textures can share a slow
    // connection for over a minute. Network errors still reject immediately.
    const timeout=setTimeout(()=>{
      if(finished)return;
      release();reject(new Error(`Proje görseli zaman aşımına uğradı: ${project.image}`));
    },120_000);
    image.src=candidates[2];
    });
  }
  function dispose(){
    if(disposed)return;disposed=true;
    for(const cancel of pendingLoads)cancel();
    if(!settled){settled=true;resolveReady();}
    for(const texture of textures)texture.dispose();
    for(const canvas of canvases){canvas.width=canvas.height=1;}
  }
  try {
  for(const index of portfolio.projects.keys()){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvases.push(canvas);
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Proje görsel yüzeyi hazırlanamadı.');
    const map=new THREE.CanvasTexture(canvas);
    map.name=`personal-project-${index}`;map.colorSpace=THREE.SRGBColorSpace;
    map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;
    textures.push(map);
  }
  }catch(error){dispose();throw error;}
  // Bound decoded-image peaks. After projection only the shared canvas survives.
  let next=0;
  async function worker(){
    while(next<portfolio.projects.length&&!disposed&&!failure)await loadImage(next++);
  }
  function load(){
    if(started||disposed)return ready;
    started=true;
    void Promise.all([worker(),worker()]).then(()=>{
      if(!settled){settled=true;resolveReady();}
    }).catch(error=>fail(error instanceof Error?error:new Error(String(error))));
    return ready;
  }
  if(!deferred)void load();
  return {
    textures,averageColors,ready,load,diagnostics,
    update(indices:readonly number[],paused=false){
      if(failure)throw failure;
      if(disposed)return;
      diagnostics.visible=paused?[]:[...indices];
    },
    dispose,
  };
}
