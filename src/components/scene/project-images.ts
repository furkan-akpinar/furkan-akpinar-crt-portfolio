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
export function createProjectImages() {
  const width=1536,height=Math.round(width/PROJECT_FILM.mediaAspect);
  let disposed=false,settled=false;
  let failure:Error|null=null;
  let resolveReady:()=>void,rejectReady:(reason:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const averageColors=portfolio.projects.map(project=>new THREE.Color(project.color));
  const diagnostics={source:'user-project-screenshots',readyCount:0,total:portfolio.projects.length,visible:[] as number[],error:null as string|null};
  const images:HTMLImageElement[]=[];
  const canvases:HTMLCanvasElement[]=[];
  const textures:THREE.CanvasTexture[]=[];
  const sampler=document.createElement('canvas');sampler.width=sampler.height=16;
  const sample=sampler.getContext('2d',{willReadFrequently:true});
  function fail(error:Error){
    if(disposed||settled)return;
    failure=error;diagnostics.error=error.message;settled=true;clearTimeout(timeout);rejectReady(error);
  }
  const timeout=setTimeout(()=>fail(new Error('Proje görselleri yüklenemedi.')),30_000);
  for(const [index,project] of portfolio.projects.entries()){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvases.push(canvas);
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Proje görsel yüzeyi hazırlanamadı.');
    const map=new THREE.CanvasTexture(canvas);
    map.name=`personal-project-${index}`;map.colorSpace=THREE.SRGBColorSpace;
    map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;
    textures.push(map);
    const image=new Image();images.push(image);
    image.onload=()=>{
      if(disposed||failure)return;
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
      if(diagnostics.readyCount===portfolio.projects.length&&!settled){settled=true;clearTimeout(timeout);resolveReady();}
    };
    image.onerror=()=>fail(new Error(`Proje görseli yüklenemedi: ${project.image}`));
    image.src=project.image;
  }
  return {
    textures,averageColors,ready,diagnostics,
    update(indices:readonly number[],paused=false){
      if(failure)throw failure;
      if(disposed)return;
      diagnostics.visible=paused?[]:[...indices];
    },
    dispose(){
      if(disposed)return;disposed=true;clearTimeout(timeout);
      if(!settled){settled=true;resolveReady();}
      for(const image of images){image.onload=null;image.onerror=null;image.removeAttribute('src');}
      for(const texture of textures)texture.dispose();
      for(const canvas of canvases){canvas.width=canvas.height=1;}
      sampler.width=sampler.height=1;
    },
  };
}
