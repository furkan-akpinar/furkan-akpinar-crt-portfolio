/** Shared by the canvas lettering and its two real, keyboard-accessible links. */
export function projectCaptionLayout(width:number,height:number) {
  const mobile=width<900;
  const scale=Math.min(width/1440,height/900);
  const fontSize=mobile?16.5:20*scale;
  const baseline=mobile?244:height*.288;
  const linkWidth=mobile?132:158*scale;
  const gap=mobile?20:30*scale;
  const top=baseline-fontSize-10;
  const linkHeight=Math.max(44,fontSize+20);
  return {
    fontSize,baseline,
    repository:{x:width/2-gap/2-linkWidth,y:top,width:linkWidth,height:linkHeight},
    website:{x:width/2+gap/2,y:top,width:linkWidth,height:linkHeight},
  };
}
