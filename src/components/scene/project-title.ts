import * as THREE from 'three/webgpu';
import { cos, sin, positionLocal, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { createCanvasUI } from './canvas-ui';
import type { SceneRuntime } from './runtime';
import { portfolio } from '@/content/portfolio';

/** Two cached captions: typography is rasterized once per selection, motion is GPU-only. */
export function createProjectTitle(width:number,height:number) {
  const scene=new THREE.Scene();
  const shape=new THREE.PlaneGeometry(2,2,12,8);
  let w=width,h=height,key='';
  const slots=[0,1].map(()=>{
    const ui=createCanvasUI(w,h);
    const angle=uniform(0), opacity=uniform(0), lift=uniform(0), blur=uniform(0);
    const pixel=uniform(new THREE.Vector2(1/w,1/h));
    const material=new THREE.MeshBasicNodeMaterial({transparent:true,depthTest:false,depthWrite:false});
    const pivot=uniform(0.6);
    const relative=positionLocal.xy.sub(vec2(0,pivot));
    const depth=relative.y.mul(sin(angle)).mul(0.95).add(1);
    material.positionNode=vec3(relative.x.div(depth),relative.y.mul(cos(angle)).div(depth).add(pivot).add(lift),0);
    const shift=pixel.mul(vec2(1,3)).mul(blur);
    const tex=texture(ui.texture,uv());
    const soft=tex.mul(0.5).add(texture(ui.texture,uv().add(shift)).mul(0.25))
      .add(texture(ui.texture,uv().sub(shift)).mul(0.25));
    material.colorNode=vec4(soft.rgb,soft.a.mul(opacity));
    material.toneMapped=false;
    const mesh=new THREE.Mesh(shape,material);scene.add(mesh);
    return {ui,material,angle,opacity,lift,blur,pixel,pivot,mesh};
  });
  const ease=(x:number)=>1-Math.pow(1-THREE.MathUtils.clamp(x,0,1),3);
  function captionRoll(slot:(typeof slots)[number],roll:number,entryRoll=0) {
    // Roll around the caption baseline, not the full-screen canvas origin.
    // Keep the independent entrance transform unchanged when carousel roll is 0.
    const pivot=slot.pivot.value+slot.lift.value;
    const x=pivot*Math.sin(roll),y=pivot*(1-Math.cos(roll));
    slot.mesh.rotation.z=entryRoll+roll;
    slot.mesh.position.set(x*Math.cos(entryRoll)-y*Math.sin(entryRoll),x*Math.sin(entryRoll)+y*Math.cos(entryRoll),0);
  }
  function update(runtime:SceneRuntime,exit:number,entrance=1) {
    const count=portfolio.projects.length;
    const incoming=((runtime.projectTarget%count)+count)%count;
    const nextKey=`${w}/${h}/${runtime.projectFrom}/${incoming}`;
    if(nextKey!==key){
      slots.forEach((slot,i)=>slot.ui.draw({mode:'project-title',progress:0,bootProgress:1,projectIndex:i?incoming:runtime.projectFrom,headerVisible:false}));
      key=nextKey;
    }
    const t=runtime.reducedMotion?1:runtime.projectMotion;
    // The outgoing caption holds while the incoming panel is still distant,
    // then folds down quickly; ease-out used to erase it before the film moved.
    const departure=Math.pow(THREE.MathUtils.clamp(t/0.48,0,1),3),arrival=ease((t-0.48)/0.52);
    const visible=(1-THREE.MathUtils.smoothstep(exit,0,0.25))*Math.sqrt(entrance);
    const previous=slots[0],next=slots[1];
    previous.opacity.value=(1-departure)*visible;
    previous.angle.value=departure*1.35;
    previous.lift.value=-departure*0.28;
    captionRoll(previous,-0.11*Math.sin(departure*Math.PI));
    previous.blur.value=Math.sin(departure*Math.PI)*3;
    next.opacity.value=runtime.projectIndex===incoming?ease((t-0.5)/0.13)*visible:0;
    // Entry has its own perspective arrival from behind the ribbon. It must
    // not show a settled caption while the Hamn-leading arc is still opening.
    const revealArrival=arrival*entrance;
    next.angle.value=-(1-revealArrival)*1.37;
    next.lift.value=(1-arrival)*0.115-Math.sin(arrival*Math.PI)*0.018-(1-entrance)*0.32;
    captionRoll(next,-0.16*Math.sin(arrival*Math.PI)*entrance,-(1-entrance)*0.08);
    next.blur.value=Math.sin(revealArrival*Math.PI)*1.7;
  }
  return {scene,update,resize(width:number,height:number){
    w=width;h=height;key='';
    slots.forEach(slot=>{slot.ui.resize(w,h);slot.pixel.value.set(1/w,1/h);slot.pivot.value=w<900?1-440/h:0.6;});
  },dispose(){shape.dispose();for(const slot of slots){slot.ui.dispose();slot.material.dispose();}scene.clear();}};
}
