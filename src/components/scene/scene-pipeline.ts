import * as THREE from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Fn, If, color, float, mix, mx_fractal_noise_float, sin, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { createCommodoreComputer } from './commodore-computer';
import { createCanvasUI } from './canvas-ui';
import { createLaterScenes } from './later-scenes';
import { createProjectImages } from './project-images';
import { getSceneState } from '@/config/scenes';
import { heroTravel, type SceneRuntime } from './runtime';
import { createProjectRing } from './project-ring';
import { createHeroGround } from './hero-ground';
import { createHeroReel } from './hero-reel';
import { applyHeroParallax, heroPointerBlend } from './hero-parallax';
import { createProjectTitle } from './project-title';
import { sampleProjectEntry, type ProjectEntry } from './project-entry';
import { PAPER, PAPER_OUTPUT_BALANCE } from './paper-ui';
import { sampleProjectAbout } from './project-about-transition';
import { createProjectAperture } from './project-aperture';
import { navigationSection } from './navigation-layout';
import { sampleCurlProgress } from '@/lib/about-curl';
import { createMenuSignalEffect } from './menu-signal-effect';
import { heroPromptCount } from './hero-prompt-motion';
import { createHeroTextWave } from './hero-text-wave';
import { selectComputerTextureQuality } from './model-quality';
import { createResourceScope } from './resource-scope';

const smooth = (value: number) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/** One renderer, dependency-ordered FBOs, and one final CRT composite for scene + UI. */
export function createScenePipeline(renderer: THREE.WebGPURenderer, width: number, height: number, fonts: Promise<unknown> = Promise.resolve()) {
  const resources = createResourceScope();
  try { return buildScenePipeline(renderer, width, height, resources, fonts); }
  catch (error) { resources.dispose(); throw error; }
}

function buildScenePipeline(renderer: THREE.WebGPURenderer, width: number, height: number, resources: ReturnType<typeof createResourceScope>, fonts: Promise<unknown>) {
  const own = resources.own;
  let w = width, h = height;
  // Select before decoding any image, then retain the same model across rotations.
  const textureQuality = selectComputerTextureQuality({
    viewportWidth: width,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    mobileUserAgent: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  });
  const time = uniform(0);
  const paperColorEnabled = uniform(0);
  const aboutCRT = uniform(0);
  const aboutCurvature = uniform(0.1);
  const logicalPixel = uniform(new THREE.Vector2(1 / width, 1 / height));
  const laterGrain = uniform(1);
  const firstSceneCRT = uniform(1);
  const firstSceneGlow = uniform(1);
  const projectLook = uniform(0);
  const projectFrameCurve = uniform(1);
  const bootMix = uniform(1);
  const bootScale = uniform(0.95);
  const bootExtent = uniform(new THREE.Vector2(0.427,0.427));
  const bootCurvature = uniform(new THREE.Vector2(0.19,0.18));
  const bootTexel = uniform(new THREE.Vector2(2/width,2/height));
  const screenBoot = uniform(1);
  const screenScale = uniform(new THREE.Vector2(1, 1));
  const scanAmount = uniform(1);
  const pixel = uniform(new THREE.Vector2(1 / width, 1 / height));
  const heroTarget = own(new THREE.RenderTarget(width, height, { depthBuffer: true }));
  const projectsTarget = own(new THREE.RenderTarget(width, height, { depthBuffer: true }));
  const aboutTarget = own(new THREE.RenderTarget(width, height, { depthBuffer: true }));
  // The extra fullscreen pass runs only for the menu signal (and boot warmup).
  const signalSource = own(new THREE.RenderTarget(width, height, { depthBuffer: false, type: THREE.HalfFloatType }));
  const menuSignal = own(createMenuSignalEffect(signalSource.texture,width,height,renderer.toneMapping));
  const signalQuad = own(new THREE.QuadMesh(menuSignal.material));
  const aperture = createProjectAperture();
  const later = own(createLaterScenes(renderer, width, height, true));
  const gallery = own(createProjectImages(textureQuality === 'mobile' ? 1024 : 1536, true));
  const heroReel=own(createHeroReel());
  const entryMediaIndices=[4,5,6,0];
  let assetsReady = false;
  let fontsReady = false, heroCompiled = false;
  let warmupStarted = false, warmupFinished = false;
  let contentAssetsReady = false, contentReady = false;
  let contentWarmupStage = 0;
  let preparedPosters = 0;
  let bloomDirty = true;
  const renderWork = { hero:0, projects:0, bloom:0 };
  let lastProjectsFrame = '', lastPresentedFrame = '';
  let targetsInitialized = false, disposed = false;
  let assetError: unknown;
  const mainUI = own(createCanvasUI(width, height));
  const projectsUI = own(createCanvasUI(width, height));
  const bootUI = own(createCanvasUI(width, height));
  const navigationUI = own(createCanvasUI(width, height));
  const aboutNavigationUI = own(createCanvasUI(width, height));
  const projectTitle = own(createProjectTitle(width,height));
  const hero = new THREE.Scene();
  const projects = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.01, 100);
  const projectCamera = new THREE.PerspectiveCamera(42, width / height, 0.1, 500);
  const uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  uiCamera.position.z = 1;
  const plane = own(new THREE.PlaneGeometry(2, 2));
  const uiScene = (map: THREE.Texture) => {
    const scene = new THREE.Scene();
    const material = own(new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
    scene.add(new THREE.Mesh(plane, material));
    return scene;
  };
  const heroUI = uiScene(mainUI.texture);
  const heroText = heroUI.children[0] as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicNodeMaterial>;
  const heroWave = own(createHeroTextWave(width,height));
  heroText.geometry = heroWave.geometry;
  heroText.material.positionNode = heroWave.positionNode;
  const pointer = new THREE.Vector2();
  const cameraPointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();
  const screenTint = new THREE.Color();
  const projectTint = new THREE.Color();
  const projectAmbient = new THREE.Color('#334464');
  const screenCells = Array.from({length:12},()=>new THREE.Color());
  const lookTarget = new THREE.Vector3();
  const screenBlend = uniform(0);
  const projectUI = uiScene(projectsUI.texture);
  const navigation = uiScene(navigationUI.texture);
  const aboutNavigation = uiScene(aboutNavigationUI.texture);

  // Original procedural cloud field: the reference HDR/environment has not been copied.
  const sky = own(new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false }));
  const cloud = mx_fractal_noise_float(vec3(uv().mul(vec2(4, 11)), time.mul(0.017)), 4).mul(0.5).add(0.5);
  const mistBand = float(1).sub(uv().y.sub(0.25).abs().mul(1.8)).clamp(0, 1).pow(2);
  sky.colorNode = mix(color('#101011'), color('#938994'), cloud.pow(3).mul(mistBand).mul(0.88));
  const backdrop = new THREE.Scene();
  backdrop.add(new THREE.Mesh(plane, sky));
  const projectSky = own(new THREE.MeshBasicNodeMaterial({depthWrite:false,depthTest:false}));
  projectSky.colorNode = mix(mix(color('#476284'),color('#222136'),uv().y.smoothstep(0,0.62)),color('#222134'),uv().y.smoothstep(0.60,1));
  const projectBackdrop = new THREE.Scene();
  projectBackdrop.add(new THREE.Mesh(plane, projectSky));

  // Use the original curved screen geometry with its authored clear coating.
  // The image is emission, not diffuse color, so stronger incident lighting
  // cannot multiply the video into an overexposed rectangle.
  const screenMaterial = own(new THREE.MeshPhysicalNodeMaterial({
    color: 0x000000, roughness: 0.18, metalness: 0,
    clearcoat: 0.8274310931233314, clearcoatRoughness: 0.04, ior: 1.52,
  }));
  const screenUV = uv().flipY().sub(0.5).mul(screenScale).add(0.5);
  const scan = sin(screenUV.y.mul(650)).mul(0.025).sub(0.025).mul(scanAmount).add(1);
  const preview=texture(heroReel.texture,uv());preview.updateMatrix=true;
  const glassResponse = screenBlend.oneMinus().mul(screenBoot.oneMinus()).mul(scanAmount);
  screenMaterial.clearcoatNode = glassResponse.mul(0.8274310931233314);
  screenMaterial.specularIntensityNode = glassResponse;
  screenMaterial.emissiveNode = mix(mix(preview.rgb.mul(1.12),texture(projectsTarget.texture, screenUV).rgb,screenBlend), texture(bootUI.texture, screenUV.flipY()).rgb, screenBoot).mul(scan);
  const computer = own(createCommodoreComputer(screenMaterial, textureQuality));
  hero.add(computer.group);
  const ground=own(createHeroGround(computer));hero.add(ground.group);
  hero.add(new THREE.AmbientLight('#d1c6bf', 0.6));
  const key = new THREE.DirectionalLight('#ffe1bc', 1.9); key.position.set(-4, 5, 6); hero.add(key);
  key.castShadow=true; key.shadow.mapSize.set(1024,1024);
  own(key.shadow);
  key.shadow.camera.left=-8;key.shadow.camera.right=8;key.shadow.camera.top=6;key.shadow.camera.bottom=-6;
  key.shadow.bias=-0.001;key.shadow.normalBias=0.03;key.shadow.radius=3;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  key.shadow.autoUpdate=false;key.shadow.needsUpdate=true;
  // All four destinations prepare during boot; no section starts downloading
  // only after the visitor tries to enter it. The gallery retains two workers
  // to bound simultaneous image decoding on mobile.
  Promise.all([heroReel.ready,computer.ready,menuSignal.ready]).then(()=>{
    if(disposed)return;
    assetsReady=true;key.shadow.needsUpdate=true;
  }).catch(error=>{if(!disposed)assetError=error;});
  Promise.all([later.ready,gallery.ready]).then(()=>{
    if(!disposed){contentAssetsReady=true;later.resize(w,h);}
  }).catch(error=>{if(!disposed)assetError=error;});
  void gallery.load();
  void later.load();
  const rim = new THREE.DirectionalLight('#94a4db', 2); rim.position.set(5, 3, -3); hero.add(rim);
  const fill = new THREE.DirectionalLight('#dad8df', 0.9); fill.position.set(1, -1, 5); hero.add(fill);

  const ring=own(createProjectRing(gallery.textures));
  projects.add(ring.group);

  // All visual layers pass through this TSL shader, including type and boot graphics.
  const composite = own(new THREE.MeshBasicNodeMaterial());
  const centered = uv().sub(0.5);
  const distortion = centered.mul(centered.dot(centered)).mul(bootMix.mul(0.025).add(firstSceneCRT.mul(0.006)).add(0.006).add(aboutCurvature.sub(0.006).mul(aboutCRT)));
  const coord = uv().add(distortion);
  const edge = float(1).sub(centered.x.abs().mul(2).pow(16).add(centered.y.abs().mul(2).pow(16)).mul(bootMix.mul(0.6).add(0.1))).clamp(0, 1);
  const shift = pixel.mul(vec2(0.7, 0.15)).mul(firstSceneGlow.mul(0.7).add(1)).mul(mix(float(1),float(0.45),projectLook));
  const source = texture(heroTarget.texture, coord);
  const sourceR = texture(heroTarget.texture, coord.add(shift));
  const sourceB = texture(heroTarget.texture, coord.sub(shift));
  const glowOffset=pixel.mul(4);
  const glow=texture(heroTarget.texture,coord.add(vec2(glowOffset.x,0))).rgb.sub(0.72).max(0)
    .add(texture(heroTarget.texture,coord.sub(vec2(glowOffset.x,0))).rgb.sub(0.72).max(0))
    .add(texture(heroTarget.texture,coord.add(vec2(0,glowOffset.y))).rgb.sub(0.72).max(0))
    .add(texture(heroTarget.texture,coord.sub(vec2(0,glowOffset.y))).rgb.sub(0.72).max(0)).mul(0.075);
  const phosphorBloom=own(bloom(texture(heroTarget.texture),0.22,0.1,0.72));
  const updateBloom=phosphorBloom.updateBefore.bind(phosphorBloom);
  phosphorBloom.updateBefore=frame=>{
    if(firstSceneGlow.value>0&&bloomDirty){updateBloom(frame);bloomDirty=false;renderWork.bloom++;}
    else return false; // A skipped FRAME update may still be needed by offscreen warmup later this frame.
  };
  const paperPaletteMask = source.rgb.sub(color(PAPER).rgb).length().smoothstep(0.003, 0.025).oneMinus().mul(paperColorEnabled);
  const paperBalance = mix(vec3(1), vec3(...PAPER_OUTPUT_BALANCE), paperPaletteMask);
  const projectGlow=mix(float(1),float(0.25),projectLook);
  const crtScene = vec3(sourceR.r, source.g, sourceB.b).mul(paperBalance).add(glow.mul(projectGlow)).add(phosphorBloom.rgb.mul(firstSceneGlow).mul(projectGlow));
  // The text and the glass boundary share one bowed surface. Rounded corners
  // alone left the old loading screen's long edges flat.
  const bootSurface=centered.mul(vec2(1).add(vec2(centered.y.pow(2),centered.x.pow(2)).mul(bootCurvature)));
  const bootCoord=bootSurface.div(bootScale).add(0.5);
  const bootCorner=bootSurface.abs().sub(bootExtent);
  const bootDistance=bootCorner.max(0).length().add(bootCorner.x.max(bootCorner.y).min(0)).sub(0.05);
  const bootMask=float(1).sub(bootDistance.smoothstep(0,0.003));
  // A fixed logical raster keeps the terminal lettering coarsely sampled even
  // on high-DPR displays. This treatment belongs only to the loading screen.
  const bootRaster=bootCoord.flipY().div(bootTexel).floor().add(0.5).mul(bootTexel);
  const bootFringe=bootTexel.mul(vec2(0.55,0.08));
  const bootBase=texture(bootUI.texture,bootRaster);
  const bootRed=texture(bootUI.texture,bootRaster.add(bootFringe));
  const bootBlue=texture(bootUI.texture,bootRaster.sub(bootFringe));
  const bootBleed=texture(bootUI.texture,bootRaster.add(vec2(bootTexel.x.mul(1.5),0))).rgb.sub(0.62).max(0)
    .add(texture(bootUI.texture,bootRaster.sub(vec2(bootTexel.x.mul(1.5),0))).rgb.sub(0.62).max(0)).mul(0.08);
  const bootScan=sin(bootRaster.y.div(bootTexel.y).mul(Math.PI)).mul(0.012).add(0.988);
  const boot = vec3(bootRed.r,bootBase.g,bootBlue.b).add(bootBleed).mul(vec3(1.04,0.97,0.98)).mul(bootScan).mul(bootMask);
  // Full-viewport Alamance capture: sides inset 14–31px, lower edge y878–890
  // at 1440×900. The bowed boundary belongs to projects, not the hero viewport.
  const curvedBounds=centered.abs().add(vec2(centered.y.pow(2).mul(0.065),centered.x.pow(2).mul(0.069)).mul(projectFrameCurve));
  const frameRadius=mix(float(0.01),float(0.024),projectFrameCurve);
  const frameExtent=mix(vec2(0.5,0.501),vec2(0.4889,0.488),projectFrameCurve);
  const rounded=curvedBounds.sub(frameExtent.sub(frameRadius));
  const roundDistance=rounded.max(0).length().add(rounded.x.max(rounded.y).min(0)).sub(frameRadius);
  const screenMask=mix(float(1),float(1).sub(roundDistance.smoothstep(0,0.003)),firstSceneCRT);
  const grainPixel=uv().div(pixel).floor().dot(vec2(12.9898,78.233));
  const movingGrain=sin(grainPixel.add(time.mul(12).floor())).mul(43758.5453).fract().sub(0.5);
  const fixedGrain=sin(grainPixel).mul(43758.5453).fract().sub(0.5);
  // Reference grain is predominantly stable; the old fully changing noise was
  // 5–10× stronger temporally. Recorded panel textures already contain its grain.
  const projectGrain=fixedGrain.mul(0.012).add(movingGrain.mul(0.0038)).mul(vec3(1,1,0.7));
  const bootGrain=fixedGrain.mul(0.018).add(movingGrain.mul(0.005));
  const grain=mix(mix(movingGrain.mul(0.028).mul(laterGrain),projectGrain,projectLook),bootGrain,bootMix);
  const outgoing = Fn(()=>{
    const sceneColor=vec3(0).toVar();
    // While the boot surface is opaque, the hidden scene does not need its
    // multi-tap CRT treatment. The reveal uses the exact original expression.
    If(bootMix.lessThan(1),()=>{sceneColor.assign(crtScene.mul(screenMask));});
    return mix(sceneColor,boot,bootMix).mul(edge).add(grain);
  })();
  // Compose after each surface's treatment: the opening removes the CRT frame
  // locally, instead of stretching the film or warping the incoming paper.
  // Both incoming and settled About use the same glass. Logical pixels keep
  // its softness/fringe stable on high-DPR screens. No additional outer bezel:
  // the live About reference fills the viewport (unlike the projects screen).
  const sampleAboutCRT=(map:THREE.Texture,incoming=false)=>{
    // Interpolate coordinates, not two differently warped images: otherwise
    // the fading treatment would double the text during the page curl.
    const curvature=incoming?aboutCurvature:mix(float(0.006),aboutCurvature,aboutCRT);
    const glassUV=uv().add(centered.mul(centered.dot(centered)).mul(curvature));
    const fringe=logicalPixel.mul(vec2(0.8,0.2));
    const radius=logicalPixel.mul(0.55);
    const read=(at:typeof glassUV)=>{
      const texel=texture(map,at).rgb;
      // Correct each tap before filtering; masking an already blurred sample
      // would create a colored outline around the cream/type boundary.
      const paper=texel.sub(color(PAPER).rgb).length().smoothstep(0.003,0.025).oneMinus();
      return texel.mul(mix(vec3(1),vec3(...PAPER_OUTPUT_BALANCE),paper)).add(paper.mul(vec3(0.10,0.09,0.025)));
    };
    const base=read(glassUV);
    const channels=vec3(read(glassUV.add(fringe)).r,base.g,read(glassUV.sub(fringe)).b);
    const soft=read(glassUV.add(vec2(radius.x,0))).add(read(glassUV.sub(vec2(radius.x,0))))
      .add(read(glassUV.add(vec2(0,radius.y)))).add(read(glassUV.sub(vec2(0,radius.y)))).mul(0.25);
    const signal=mix(channels,soft,0.22);
    const dark=float(1).sub(base.dot(vec3(0.2126,0.7152,0.0722))).clamp(0,1).pow(3);
    const inkLift=vec3(0.05,0.042,0.035).mul(dark);
    const glassEdge=float(1).sub(centered.x.abs().mul(2).pow(16).add(centered.y.abs().mul(2).pow(16)).mul(0.1)).clamp(0,1);
    const raster=uv().div(logicalPixel).floor();
    const seed=raster.dot(vec2(12.9898,78.233));
    const staticNoise=sin(vec3(seed,seed.add(23.47),seed.add(91.13))).mul(43758.5453).fract().sub(0.5);
    const temporalNoise=sin(seed.add(time.mul(12).floor())).mul(43758.5453).fract().sub(0.5);
    // Reference stills: ~1/1.5/1.5 RGB-byte spatial variance, with only a
    // small changing component. Avoid flickering full-strength white noise.
    // ACES amplifies small changes near black. Modulate before tone mapping
    // so ink and the blue curl destination do not acquire colored speckles.
    const light=base.dot(vec3(0.2126,0.7152,0.0722)).smoothstep(0.12,0.85);
    const noise=staticNoise.mul(vec3(0.10,0.115,0.063)).mul(mix(float(0.16),float(1.5),light))
      .add(temporalNoise.mul(vec3(0.006,0.007,0.004)).mul(mix(float(0.16),float(0.8),light)));
    return signal.add(inkLift).mul(glassEdge).add(noise);
  };
  composite.colorNode=Fn(()=>{
    const result=outgoing.toVar();
    If(aboutCRT.greaterThan(0),()=>{
      result.assign(mix(outgoing,sampleAboutCRT(heroTarget.texture),aboutCRT));
    });
    If(aperture.enabled.greaterThan(0),()=>{
      const revealed=mix(sampleAboutCRT(aboutTarget.texture,true),vec3(1.56),aperture.exposure);
      result.assign(mix(outgoing,revealed,aperture.mask).add(vec3(2.6,2.25,1.58).mul(aperture.rimColor)).add(vec3(1.05,0.91,0.65).mul(aperture.halo)));
    });
    return vec4(result,1);
  })();
  const quad = own(new THREE.QuadMesh(composite));
  const worldCenter = new THREE.Vector3();
  const screenNormal = new THREE.Vector3();
  const screenRotation = new THREE.Quaternion();
  const screenWorldScale = new THREE.Vector3();
  const targetCamera = new THREE.Vector3();
  const startCamera = new THREE.Vector3();
  const startQuaternion = new THREE.Quaternion();
  const cameraRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-0.07);
  const endQuaternion = new THREE.Quaternion();
  const tempCamera = new THREE.PerspectiveCamera();
  let lastUIKey = '', lastProjectKey = '', lastNavigationKey = '', lastAboutNavigationKey = '', lastBoot = -1;
  let failed = false;
  let frames = 0;
  const entry:ProjectEntry={phase:0,camera:0,depth:0,turns:0,caption:0,offsetX:0,offsetY:0,visiblePanels:0};
  const diagnostics = { storyHeight: 0, sceneHeight: 0, scrollPosition: 0, scrollLimit: 0, scrollMode: 'native', frames: 0, passes: [] as string[], scene: 'hero', travel: 0, localProgress:0, projectExit:0, headerCount:1, fontsReady:false, assetsReady:false, contentStarted:true, contentAssetsReady:false, contentReady:false, preparedPosters:0, screenCenter: [0,0,0], computer:computer.diagnostics,  ring:ring.diagnostics, gallery:gallery.diagnostics, heroReel:heroReel.diagnostics, heroPrompt:{count:0}, heroWave:heroWave.diagnostics, projectTitle:projectTitle.diagnostics, ground:ground.diagnostics, menuSignal:{active:false,progress:0}, intro:0, shaderReady:false, projectMotion:1, pointer:[0,0], cameraPointer:[0,0], cameraPosition:[0,0,0], cameraQuaternion:[0,0,0,1], entry };

  let lastResize = '';
  function resize(nextWidth: number, nextHeight: number) {
    const resizeKey = `${nextWidth}/${nextHeight}/${renderer.getPixelRatio()}`;
    if (resizeKey === lastResize) return;
    lastResize = resizeKey;
    w = nextWidth; h = nextHeight;
    // The same reference frame is almost cropped out in portrait viewports.
    projectFrameCurve.value=Math.pow(THREE.MathUtils.clamp((w/h-0.46)/1.14,0,1),1.4);
    bootScale.value = w < 900 ? 1 : 0.95;
    bootExtent.value.set(w<900?0.45:0.427,w<900?0.45:0.427);
    bootCurvature.value.set(w<900?0.025:0.19,w<900?0.025:0.18);
    const rasterSize=w<900?1:2;
    bootTexel.value.set(rasterSize/w,rasterSize/h);
    const dpr = Math.min(renderer.getPixelRatio(), 1.5);
    heroTarget.setSize(Math.round(w*dpr), Math.round(h*dpr));
    projectsTarget.setSize(Math.round(w*dpr), Math.round(h*dpr));
    aboutTarget.setSize(Math.round(w*dpr), Math.round(h*dpr));
    targetsInitialized=false;
    bloomDirty=true;lastProjectsFrame=lastPresentedFrame='';
    signalSource.setSize(Math.round(w*dpr),Math.round(h*dpr));
    menuSignal.resize(w,h,dpr);
    mainUI.resize(w,h); projectsUI.resize(w,h); bootUI.resize(w,h); navigationUI.resize(w,h);
    heroWave.resize(w,h);heroText.geometry=heroWave.geometry;
    aboutNavigationUI.resize(w,h);
    aboutNavigationUI.draw({mode:'header',bootProgress:1,projectIndex:0,headerDark:true});
    later.resize(w,h);projectTitle.resize(w,h);key.shadow.needsUpdate=true;
    camera.aspect = projectCamera.aspect = w/h;
    camera.updateProjectionMatrix(); projectCamera.updateProjectionMatrix();
    pixel.value.set(1/(w*dpr),1/(h*dpr));
    logicalPixel.value.set(1/w,1/h);
    aboutCurvature.value=w<900?0.04:0.10;
    lastUIKey = lastProjectKey = lastNavigationKey = lastAboutNavigationKey = ''; lastBoot = -1;
    // Static model placement changes only with the viewport, not every frame.
    const mobile=w<900;
    computer.group.position.set(mobile?0:3,mobile?-0.802:-0.36,0);
    computer.group.scale.setScalar(w<500?0.64:mobile?0.69:1);
    computer.group.rotation.set(0,mobile?0:-0.67,0);
    computer.group.updateMatrixWorld(true);
  }
  resize(width,height);
  void fonts.then(()=>{
    if(disposed)return;
    fontsReady=true;diagnostics.fontsReady=true;
    // Discard any initial fallback-font measurements before the first paint.
    lastResize='';resize(w,h);
  }).catch(error=>{if(!disposed)assetError=error;});

  function render(runtime: SceneRuntime, delta: number) {
    if (failed || disposed) return;
    if (assetError) throw assetError;
    if(!fontsReady)return;
    if(contentReady&&!runtime.contentReady){
      runtime.contentReady=true;
      window.dispatchEvent(new Event('study-content-ready'));
    }
    diagnostics.contentAssetsReady=contentAssetsReady;
    diagnostics.contentReady=contentReady;
    diagnostics.preparedPosters=preparedPosters;
    diagnostics.storyHeight = runtime.storyHeight;
    diagnostics.sceneHeight = runtime.sceneHeight;
    diagnostics.scrollPosition = runtime.scrollPosition;
    diagnostics.scrollLimit = runtime.scrollLimit;
    diagnostics.scrollMode = runtime.controlledScroll ? 'controlled' : 'native';
    runtime.time += runtime.reducedMotion ? 0 : Math.min(delta, 0.1);
    time.value = runtime.time;
    menuSignal.progress.value=runtime.menuSignalProgress;
    menuSignal.motion.value=runtime.reducedMotion?0:1;
    diagnostics.menuSignal.active=runtime.menuSignalActive;
    diagnostics.menuSignal.progress=runtime.menuSignalProgress;
    bootMix.value = 1-smooth(runtime.intro/0.16);
    screenBoot.value = 1-smooth((runtime.intro-0.4)/0.4);
    // Input arbitration holds the real scroll too. This also covers restored
    // positions before the scroll owner has attached on the first frame.
    const progress=contentReady?runtime.progress:0;
    const state = getSceneState(progress);
    const p = heroTravel(progress);
    sampleProjectEntry(p,runtime.reducedMotion,entry);
    const mobile = w < 900;
    const laterScene = state.scene.id !== 'hero' && state.scene.id !== 'projects';
    firstSceneCRT.value=laterScene?0:smooth((entry.camera-0.9)/0.1);
    firstSceneGlow.value=laterScene||bootMix.value===1?0:1;
    projectLook.value=firstSceneCRT.value;
    screenBlend.value=smooth((p-0.02)/0.25);
    const exit = state.scene.id==='projects'?sampleProjectAbout(progress):0;
    aperture.update(exit,w,h,runtime.time,runtime.reducedMotion);
    if(!laterScene){
    projectTitle.update(runtime, entry.caption, state.scene.id==='projects'||(state.scene.id==='hero'&&entry.phase>0));
    const entryStart=Math.round(runtime.projectPosition)-3;
    ring.update(runtime.projectPosition + entry.turns, mobile, entry.visiblePanels, entryStart, w / h);
    for(let i=0;i<entryMediaIndices.length;i++)entryMediaIndices[i]=((entryStart+i)%gallery.textures.length+gallery.textures.length)%gallery.textures.length;
    ring.group.position.x=entry.offsetX*(mobile?0.45:1);
    ring.group.position.y+=entry.offsetY;
    ring.group.position.z=entry.depth;
    (projectUI.children[0] as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicNodeMaterial>).material.opacity=entry.caption;
    const projectKey = `${w}/${h}/${runtime.projectIndex}`;
    if (projectKey !== lastProjectKey) {
      projectsUI.draw({mode:'projects',bootProgress:1,projectIndex:runtime.projectIndex,headerVisible:false});
      lastProjectKey = projectKey;
    }
    }
    // No extra timer or per-frame texture upload: repaint only on a 450 ms beat
    // while this UI is visible. Other scenes keep their existing cached artwork.
    if (state.scene.id === 'hero' && !document.hidden && (runtime.intro>0.6||!lastUIKey)) {
      // Match the reference's wall-clock interval even after a delayed frame.
      const promptCount = heroPromptCount(performance.now() / 1000, runtime.reducedMotion);
      const uiKey = `${w}/${h}/${promptCount}`;
      if (uiKey !== lastUIKey) {
        mainUI.draw({mode:'hero',bootProgress:1,projectIndex:runtime.projectIndex,headerVisible:false,heroPromptCount:promptCount});
        lastUIKey = uiKey;
        diagnostics.heroPrompt.count = promptCount;
      }
    }
    const paperCurl=state.scene.id==='about-us'?sampleCurlProgress(state.localProgress):undefined;
    // The blue destination keeps its accepted treatment. Fade the extra glass
    // continuously with the curl, or follow its cut in reduced-motion mode.
    aboutCRT.value=paperCurl===undefined?0:runtime.reducedMotion?(paperCurl<0.5?1:0):1-smooth(paperCurl);
    aboutCRT.value*=1-bootMix.value;
    const activeSection=navigationSection(state.scene.id);
    const darkHeader=state.scene.id==='about-us';
    const navigationKey=`${w}/${h}/${activeSection}/${Math.round((paperCurl??0)*1000)}/${darkHeader}/${laterScene}/${runtime.menuOpen}/${runtime.hovered}`;
    if(navigationKey!==lastNavigationKey) {
      navigationUI.draw({mode:'header',bootProgress:1,projectIndex:runtime.projectIndex,headerDark:darkHeader,menuOpen:runtime.menuOpen,hovered:runtime.hovered,activeSection,paperCurl:runtime.reducedMotion&&paperCurl!==undefined?(paperCurl<.5?0:1):paperCurl});
      lastNavigationKey=navigationKey;
    }
    if(exit>0) {
      const aboutNavigationKey=`${w}/${h}/${runtime.menuOpen}/${runtime.hovered}`;
      if(aboutNavigationKey!==lastAboutNavigationKey) {
        aboutNavigationUI.draw({mode:'header',bootProgress:1,projectIndex:runtime.projectIndex,headerDark:true,menuOpen:runtime.menuOpen,hovered:runtime.hovered,activeSection:'about-us'});
        lastAboutNavigationKey=aboutNavigationKey;
      }
    }
    const bootStep = Math.round(runtime.bootProgress*24);
    if(bootStep !== lastBoot && runtime.intro < 1) {
      bootUI.draw({mode:'boot',bootProgress:runtime.bootProgress,projectIndex:0}); lastBoot = bootStep;
    }
    const parallax = runtime.reducedMotion ? 0 : (1-smooth(p))*smooth(runtime.intro);
    pointer.lerp(pointerTarget.set(runtime.pointerX,runtime.pointerY),1-Math.exp(-Math.min(delta,0.1)*9));
    cameraPointer.lerp(pointerTarget,heroPointerBlend(delta));
    const titleTravel=runtime.reducedMotion?0:smooth(entry.phase/0.55);
    const titleScale=1+titleTravel*0.8;
    heroText.scale.set(titleScale*(1+pointer.x*0.025*parallax),titleScale,1);
    heroText.position.set(pointer.x*0.00775*parallax-titleTravel*0.16,pointer.y*0.003*parallax-titleTravel*0.24-(1-smooth((runtime.intro-0.65)/0.35))*0.025,0);
    heroText.rotation.y=pointer.x*0.045*parallax;heroText.rotation.x=-pointer.y*0.03*parallax;
    heroText.material.opacity=smooth((runtime.intro-0.65)/0.35)*(1-smooth((titleTravel-0.12)/0.5));
    heroWave.update(runtime.time,!runtime.reducedMotion&&!document.hidden&&state.scene.id==='hero'&&heroText.material.opacity>0);
    heroReel.update(!assetsReady||runtime.reducedMotion||document.hidden||runtime.intro<0.8||screenBlend.value>=1||laterScene);
    if(!laterScene&&(bootMix.value<1||!warmupFinished)){
    // The monitor remains luminous during its FBO handoff. The showreel uses
    // exact frame colors; the static project preview uses its own screenshot average.
    projectTint.copy(gallery.averageColors[runtime.projectIndex]).lerp(projectAmbient,.65);
    screenTint.copy(heroReel.averageColor).lerp(projectTint,screenBlend.value);
    for(let i=0;i<screenCells.length;i++)screenCells[i].copy(heroReel.cellColors[i]).lerp(projectTint,screenBlend.value);
    ground.update(runtime.time,1-screenBoot.value,screenTint,screenCells);
    computer.screen.getWorldPosition(worldCenter);
    computer.screen.getWorldQuaternion(screenRotation);
    screenNormal.set(0,0,1).applyQuaternion(screenRotation);
    startCamera.set(mobile?0:0.2, mobile?2.7:1.75, mobile?9.15:9.5);
    tempCamera.position.copy(startCamera);
    tempCamera.up.set(0,1,0);tempCamera.lookAt(lookTarget.set(0,mobile?0.65:0.15,0));
    startQuaternion.copy(tempCamera.quaternion);if(!mobile)startQuaternion.multiply(cameraRoll);
    // Actual screen world transform determines the camera endpoint, never a guessed DOM box.
    computer.screen.getWorldScale(screenWorldScale);
    const screenHeight = computer.screenSize.y*screenWorldScale.y;
    const screenWidth = computer.screenSize.x*screenWorldScale.x;
    const coverDistance = Math.min(screenHeight, screenWidth/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*0.92;
    targetCamera.copy(worldCenter).addScaledVector(screenNormal, coverDistance);
    tempCamera.position.copy(targetCamera); tempCamera.up.set(0,1,0).applyQuaternion(screenRotation); tempCamera.lookAt(worldCenter);
    endQuaternion.copy(tempCamera.quaternion);
    const move = runtime.reducedMotion ? 0 : Math.max(1-smooth(runtime.intro/0.82), entry.camera);
    // Match the viewport aspect inside the physical screen before the FBO handoff.
    // Cover alone crops a portrait target by ~3x; this reprojects its visible UV region.
    const visibleHeight=2*coverDistance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const physicalAspect=screenWidth/screenHeight;
    screenScale.value.set(
      THREE.MathUtils.lerp(Math.min(1,physicalAspect/camera.aspect),screenWidth/(visibleHeight*camera.aspect),move),
      THREE.MathUtils.lerp(Math.min(1,camera.aspect/physicalAspect),screenHeight/visibleHeight,move),
    );
    scanAmount.value=1-move;
    camera.position.lerpVectors(startCamera,targetCamera,move);
    if(p>0&&!runtime.reducedMotion){
      // Interpolating orientation independently used to swing the screen left
      // of the viewport before recentering. Follow the screen's actual focus.
      lookTarget.set(0,mobile?0.65:0.15,0).lerp(worldCenter,move);
      camera.up.set(0,1,0);camera.lookAt(lookTarget);
      if(!mobile)camera.rotateZ(-0.07*(1-move));
    }else camera.quaternion.slerpQuaternions(startQuaternion,endQuaternion,move);
    applyHeroParallax(camera,cameraPointer.x,cameraPointer.y,parallax);
    }
    projectCamera.position.set(0,0,ring.layout.cameraDistance);
    projectCamera.lookAt(0,0,0);
    projectCamera.rotation.z=0;
    const oldTarget = renderer.getRenderTarget();
    const oldAutoClear = renderer.autoClear;
    diagnostics.passes.length = 0;
    paperColorEnabled.value = state.scene.id === 'about-us' ? 1 : 0;
    laterGrain.value=state.scene.id==='contact'?.35:state.scene.id==='about-us'?1-smooth((state.localProgress-.72)/.08)*.65:1;
    try {
      if(!targetsInitialized){
        // The composite samples both targets even with their mix at zero.
        // Allocate valid textures without drawing or compiling the later scenes.
        for(const target of [heroTarget,projectsTarget,aboutTarget]){
          renderer.setRenderTarget(target);renderer.clear();
        }
        targetsInitialized=true;
      }
      if(laterScene)gallery.update(ring.mediaIndices,true);
      if(!laterScene&&contentReady)gallery.update(entry.phase<0.52?entryMediaIndices:ring.mediaIndices,p===0||runtime.reducedMotion||document.hidden);
      const projectFrameKey=`${lastResize}/${p}/${runtime.projectPosition}/${runtime.projectMotion}/${runtime.projectFrom}/${runtime.projectTarget}/${runtime.projectIndex}/${runtime.reducedMotion}/${mobile&&!runtime.reducedMotion?runtime.time:0}`;
      if(!laterScene&&contentReady&&p>0) {
        if(exit>0&&!runtime.reducedMotion) {
          later.render('about-us',0,runtime,aboutTarget);
          renderer.setRenderTarget(aboutTarget);renderer.autoClear=false;renderer.render(aboutNavigation,uiCamera);
          diagnostics.passes.push('about-preview');
        }
        if(lastProjectsFrame!==projectFrameKey){
        renderer.setRenderTarget(projectsTarget);
        renderer.autoClear = true; renderer.render(projectBackdrop,uiCamera);
        renderer.autoClear = false; renderer.render(projects,projectCamera); renderer.render(projectUI,uiCamera);renderer.render(projectTitle.scene,uiCamera);
        renderWork.projects++;
        lastProjectsFrame=projectFrameKey;
        }
        diagnostics.passes.push('projects');
      }
      const presentedKey=`${projectFrameKey}/${lastNavigationKey}/${runtime.intro}`;
      const presentScene=bootMix.value<1&&(state.scene.id!=='projects'||lastPresentedFrame!==presentedKey);
      if(presentScene){
      renderer.setRenderTarget(heroTarget);
      renderer.autoClear = true;
      if(state.scene.id === 'hero' && (runtime.reducedMotion?p<1:entry.camera<1)) {
        renderer.render(backdrop,uiCamera);
        renderer.autoClear = false; renderer.render(hero,camera); renderer.render(heroUI,uiCamera);
        renderWork.hero++;
        diagnostics.passes.push('hero');
      } else if(laterScene) {
        later.render(state.scene.id,state.localProgress,runtime,heroTarget);
        diagnostics.passes.push(...later.diagnostics.passes);
      } else {
        // Once inside the screen, display the exact same target directly.
        screenCopy.render(renderer);
        diagnostics.passes.push('projects-present');
      }
      renderer.setRenderTarget(heroTarget); renderer.autoClear=false;
      if(runtime.intro>0.08)renderer.render(navigation,uiCamera);
      bloomDirty=true;
      lastPresentedFrame=presentedKey;
      }else if(state.scene.id==='projects')diagnostics.passes.push('projects-present');
      renderer.autoClear = true;
      if(runtime.menuSignalActive||!warmupFinished){
        renderer.setRenderTarget(signalSource);quad.render(renderer);
        renderer.setRenderTarget(null);
        const toneMapping=renderer.toneMapping;
        try{renderer.toneMapping=THREE.NoToneMapping;signalQuad.render(renderer);}
        finally{renderer.toneMapping=toneMapping;}
        if(runtime.menuSignalActive)diagnostics.passes.push('menu-signal');
      }else{renderer.setRenderTarget(null);quad.render(renderer);}
      diagnostics.passes.push('crt-composite');
      frames++; diagnostics.frames=frames; diagnostics.scene=state.scene.id; diagnostics.travel=p;
      diagnostics.localProgress=state.localProgress; diagnostics.projectExit=exit; diagnostics.assetsReady=assetsReady;diagnostics.intro=runtime.intro;diagnostics.projectMotion=runtime.projectMotion;diagnostics.pointer[0]=pointer.x;diagnostics.pointer[1]=pointer.y;
      cameraPointer.toArray(diagnostics.cameraPointer);camera.position.toArray(diagnostics.cameraPosition);camera.quaternion.toArray(diagnostics.cameraQuaternion);
      if(assetsReady&&!warmupStarted){
        warmupStarted=true;
        // Pipeline caches include the target's format and sample count. Prepare
        // the actual offscreen view, not the browser's output framebuffer.
        renderer.setRenderTarget(heroTarget);
        camera.position.copy(startCamera);camera.quaternion.copy(startQuaternion);camera.updateMatrixWorld();
        renderer.compileAsync(hero,camera)
          .then(()=>{if(!disposed)heroCompiled=true;})
          .catch(error=>{if(!disposed)assetError=error;});
      }
      if(heroCompiled&&!warmupFinished){
        camera.position.copy(startCamera);camera.quaternion.copy(startQuaternion);camera.updateMatrixWorld();
        renderer.setRenderTarget(heroTarget);renderer.autoClear=true;renderer.render(backdrop,uiCamera);
        renderer.autoClear=false;renderer.render(hero,camera);renderer.render(heroUI,uiCamera);renderer.render(navigation,uiCamera);
        // Prepare the same final treatment offscreen once. During the opaque
        // boot it does not run again until the monitor starts revealing.
        const savedBoot=bootMix.value,savedGlow=firstSceneGlow.value;
        try{
          bootMix.value=0;firstSceneGlow.value=1;bloomDirty=true;
          renderer.setRenderTarget(signalSource);renderer.autoClear=true;quad.render(renderer);
        }finally{bootMix.value=savedBoot;firstSceneGlow.value=savedGlow;}
        warmupFinished=true;diagnostics.shaderReady=true;
      }else if(contentAssetsReady&&preparedPosters<gallery.textures.length){
        renderer.initTexture(gallery.textures[preparedPosters++]);
      }else if(contentAssetsReady&&contentWarmupStage<5){
        // Prepare every destination, including the curl shader, before opening
        // navigation. One stage per frame bounds synchronous upload work.
        const stage=contentWarmupStage++;
        if(stage===0){
          renderer.setRenderTarget(projectsTarget);renderer.autoClear=true;
          renderer.render(projectBackdrop,uiCamera);renderer.autoClear=false;
          renderer.render(projects,projectCamera);renderer.render(projectUI,uiCamera);
          renderer.render(projectTitle.scene,uiCamera);
        }else if(stage===1)later.render('contact',0,runtime,aboutTarget);
        else if(stage===2)later.render('about-us',0,runtime,aboutTarget);
        else if(stage===3)later.render('about-us',0.86,{...runtime,reducedMotion:false},aboutTarget);
        else {
          renderer.setRenderTarget(projectsTarget);
          Promise.all([renderer.compileAsync(projects,projectCamera),renderer.compileAsync(projectTitle.scene,uiCamera)])
            .then(()=>{if(!disposed)contentReady=true;})
            .catch(error=>{if(!disposed)assetError=error;});
        }
      }
      worldCenter.toArray(diagnostics.screenCenter);
    } catch(error) { failed = true; throw error; }
    finally { renderer.setRenderTarget(oldTarget); renderer.autoClear=oldAutoClear; }
  }
  const copyMaterial = own(new THREE.MeshBasicNodeMaterial({ map: projectsTarget.texture }));
  const screenCopy = own(new THREE.QuadMesh(copyMaterial));
  return { render, resize, diagnostics:Object.assign(diagnostics,{renderWork}), get isReady(){return fontsReady&&assetsReady&&warmupFinished&&contentReady;}, dispose() {
    if(disposed)return;disposed=true;
    resources.dispose();
    hero.clear(); projects.clear();
  }};
}

