import * as THREE from 'three/webgpu';
import { portfolio } from '@/content/portfolio';
import { PROJECT_FILM } from './project-ring';

/** Screenshot projection only: originals stay intact, including their provenance. */
export function projectImagePlacement(sourceWidth:number,sourceHeight:number,cropRight:number,targetWidth:number,targetHeight:number) {
  const width=Math.max(1,sourceWidth-Math.max(0,cropRight));
  const height=Math.max(1,sourceHeight);
  const scale=Math.min(targetWidth/width,targetHeight/height);
  return {sourceWidth:width,sourceHeight:height,width:width*scale,height:height*scale,x:(targetWidth-width*scale)/2,y:(targetHeight-height*scale)/2};
}

/** Load once, fit without stretching, and share these seven textures across all film slots. */
export function createProjectImages(width=1536) {
  const height=Math.round(width/PROJECT_FILM.mediaAspect);
  let disposed=false,settled=false;
  let failure:Error|null=null;
  let resolveReady:()=>void,rejectReady:(reason:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const averageColors=portfolio.projects.map(project=>new THREE.Color(project.color));
  const diagnostics={source:'user-project-screenshots',width,height,readyCount:0,total:portfolio.projects.length,visible:[] as number[],error:null as string|null};
  const canvases:HTMLCanvasElement[]=[];
  const textures:THREE.CanvasTexture[]=[];
  const pendingLoads=new Set<()=>void>();
  const sampler=document.createElement('canvas');sampler.width=sampler.height=16;
  const sample=sampler.getContext('2d',{willReadFrequently:true});
  function fail(error:Error){
    if(disposed||settled)return;
    failure=error;diagnostics.error=error.message;settled=true;
    for(const cancel of pendingLoads)cancel();
    rejectReady(error);
  }
  function load(index:number) {
    const project=portfolio.projects[index];
    const canvas=canvases[index],map=textures[index];
    const context=canvas.getContext('2d')!;
    return new Promise<void>((resolve,reject)=>{
    const image=new Image();
    let finished=false;
    const release=()=>{
      finished=true;clearTimeout(timeout);
      image.onload=null;image.onerror=null;image.removeAttribute('src');
      pendingLoads.delete(cancel);
    };
    const cancel=()=>{if(finished)return;release();resolve();};
    pendingLoads.add(cancel);
    image.onload=()=>{
      if(finished)return;
      if(disposed||failure){cancel();return;}
      try {
        const fit=projectImagePlacement(image.naturalWidth,image.naturalHeight,project.cropRight,width,height);
        context.fillStyle='#050507';context.fillRect(0,0,width,height);
        context.drawImage(image,0,0,fit.sourceWidth,fit.sourceHeight,fit.x,fit.y,fit.width,fit.height);
        map.needsUpdate=true;
        if(sample){
          sample.drawImage(image,0,0,fit.sourceWidth,fit.sourceHeight,0,0,16,16);
          const pixels=sample.getImageData(0,0,16,16).data;
          let r=0,g=0,b=0;
          for(let offset=0;offset<pixels.length;offset+=4){r+=pixels[offset];g+=pixels[offset+1];b+=pixels[offset+2];}
          averageColors[index].setRGB(r/(256*255),g/(256*255),b/(256*255),THREE.SRGBColorSpace);
        }
        diagnostics.readyCount++;
        release();resolve();
      }catch(error){release();reject(error);}
    };
    image.onerror=()=>{if(finished)return;release();reject(new Error(`Proje görseli yüklenemedi: ${project.image}`));};
    // Each active request gets the full allowance; waiting for a worker does not
    // spend the later screenshots' budget while the computer textures download.
    const timeout=setTimeout(()=>{
      if(finished)return;
      release();reject(new Error(`Proje görseli zaman aşımına uğradı: ${project.image}`));
    },30_000);
    image.src=project.image;
    });
  }
  function dispose(){
    if(disposed)return;disposed=true;
    for(const cancel of pendingLoads)cancel();
    if(!settled){settled=true;resolveReady();}
    for(const texture of textures)texture.dispose();
    for(const canvas of canvases){canvas.width=canvas.height=1;}
    sampler.width=sampler.height=1;
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
    while(next<portfolio.projects.length&&!disposed&&!failure)await load(next++);
  }
  void Promise.all([worker(),worker()]).then(()=>{
    if(!settled){settled=true;resolveReady();}
  }).catch(error=>fail(error instanceof Error?error:new Error(String(error))));
  return {
    textures,averageColors,ready,diagnostics,
    update(indices:readonly number[],paused=false){
      if(failure)throw failure;
      if(disposed)return;
      diagnostics.visible=paused?[]:[...indices];
    },
    dispose,
  };
}
