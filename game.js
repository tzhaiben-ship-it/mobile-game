'use strict';
// ═══════════════════════════════════════════════════════
// THREE.JS 3D ENGINE — SKYFORCE B-2 Spirit
// ═══════════════════════════════════════════════════════

const CAM_MODES=['cockpit','chase','external','gun','orbit'];
const CAM_LABELS=['Cockpit','Chase','External','Gun Cam','Orbit'];
const WEP_MODES=['bullets','missiles','bombs'];
const WEP_NAMES=['מקלע','טיל','פצצה'];
let currentWep=0, gameRunning=false, thrDrag=false;
const keys={};
const joy={active:false,sx:0,sy:0,dx:0,dy:0};

let CFG={
  cam:'cockpit',fov:75,sensitivity:1.0,tod:0.75,
  clouds:true,mountains:true,waves:true,bloom:true,stars:true,ai:true,aiDiff:3,
  pixelRatio:1,orbitAngle:0,
};

let S={};
function resetState(){
  const pc=S?.clouds3d??[],pm=S?.mountains3d??[];
  S={pitch:0,roll:0,heading:0,speed:165,altitude:5000,vspeed:0,throttle:.5,
     fuel:100,hp:100,
     // Infinite bullets; missiles/bombs replenished by checkpoints
     ammo:{bullets:Infinity,missiles:6,bombs:4},
     score:0,kills:0,gForce:1,gearDown:false,
     planeX:0,planeY:5000,planeZ:0,time:0,elapsed:0,
     missileLock:false,lockedTarget:null,
     targets:[],bullets:[],explosions:[],enemyBullets:[],
     clouds3d:pc,mountains3d:pm,
     // Checkpoint system
     checkpoints:[],cpCollected:[],
     // Gyro integration
     gyroActive:false,gyroPitch:0,gyroRoll:0,
     // Air combat stats
     wave:1,enemiesThisWave:0,
  };
}
resetState();

// ═══════════════════════════════════════
// THREE.JS SETUP
// ═══════════════════════════════════════
const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
// High-quality rendering — clamp at 2x DPR to avoid mobile overload
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.autoClear=true;

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,1,180000);
scene.fog=new THREE.FogExp2(0x88bce8,0.000045);

window.addEventListener('resize',()=>{
  renderer.setSize(window.innerWidth,window.innerHeight);
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
});

// ═══════════════════════════════════════
// NOISE UTILITY
// ═══════════════════════════════════════
const P=new Uint8Array(512);
(function(){for(let i=0;i<256;i++)P[i]=i;for(let i=255;i>0;i--){const j=Math.floor(Math.random()*(i+1));[P[i],P[j]]=[P[j],P[i]];}for(let i=0;i<256;i++)P[256+i]=P[i];})();
function fade(t){return t*t*t*(t*(t*6-15)+10);}
function lerp3(a,b,t){return a+t*(b-a);}
function lerp(a,b,t){return a+t*(b-a);}
function grad3(h,x,y){const v=h&3;const u=v<2?x:y,w=v<2?y:x;return((h&1)?-u:u)+((h&2)?-w:w);}
function noise2(x,y){const xi=Math.floor(x)&255,yi=Math.floor(y)&255;const xf=x-Math.floor(x),yf=y-Math.floor(y);const u=fade(xf),v=fade(yf);const aa=P[P[xi]+yi],ab=P[P[xi]+yi+1],ba=P[P[xi+1]+yi],bb=P[P[xi+1]+yi+1];return lerp3(lerp3(grad3(aa,xf,yf),grad3(ba,xf-1,yf),u),lerp3(grad3(ab,xf,yf-1),grad3(bb,xf-1,yf-1),u),v);}
function fbm(x,y,oct){let v=0,a=.5,f=1;for(let i=0;i<oct;i++){v+=noise2(x*f,y*f)*a;a*=.5;f*=2.1;}return v;}

// ═══════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════
const sunLight=new THREE.DirectionalLight(0xfffaee,2.2);
sunLight.position.set(8000,12000,5000);
sunLight.castShadow=true;
sunLight.shadow.mapSize.set(2048,2048);
sunLight.shadow.camera.near=100;
sunLight.shadow.camera.far=80000;
sunLight.shadow.camera.left=-15000;
sunLight.shadow.camera.right=15000;
sunLight.shadow.camera.top=15000;
sunLight.shadow.camera.bottom=-15000;
sunLight.shadow.bias=-0.001;
scene.add(sunLight);
const ambLight=new THREE.AmbientLight(0x334466,1.2);
scene.add(ambLight);
const hemiLight=new THREE.HemisphereLight(0x6688cc,0x224411,0.8);
scene.add(hemiLight);

// ═══════════════════════════════════════
// SKY — Custom Shader
// ═══════════════════════════════════════
const skyGeo=new THREE.SphereGeometry(120000,32,16);
const skyMat=new THREE.ShaderMaterial({
  uniforms:{
    uDayPhase:{value:0.75},
    uSunDir:{value:new THREE.Vector3(.55,.72,.42).normalize()},
    uTime:{value:0},
  },
  vertexShader:`
    varying vec3 vWorldPos;
    void main(){
      vWorldPos=position;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    }
  `,
  fragmentShader:`
    varying vec3 vWorldPos;
    uniform float uDayPhase;
    uniform vec3 uSunDir;
    uniform float uTime;

    vec3 hsl2rgb(float h,float s,float l){
      float c=(1.-abs(2.*l-1.))*s;
      float x=c*(1.-abs(mod(h*6.,2.)-1.));
      float m=l-c*.5;
      vec3 rgb=h<1./6.?vec3(c,x,0):h<2./6.?vec3(x,c,0):h<3./6.?vec3(0,c,x):h<4./6.?vec3(0,x,c):h<5./6.?vec3(x,0,c):vec3(c,0,x);
      return rgb+m;
    }

    void main(){
      vec3 dir=normalize(vWorldPos);
      float elev=dir.y; // -1 to 1

      // Rayleigh scattering — sky blue
      vec3 dayZenith=vec3(0.03,0.15,0.55);
      vec3 dayHorizon=vec3(0.35,0.62,0.92);
      vec3 dawnZenith=vec3(0.01,0.01,0.12);
      vec3 dawnHorizon=vec3(0.85,0.32,0.05);
      vec3 nightZenith=vec3(0.005,0.005,0.025);
      vec3 nightHorizon=vec3(0.01,0.01,0.06);

      float t=clamp(uDayPhase,0.,1.);
      float dawnT=1.-abs(t*2.-1.); // peaks at 0.5
      float skyT=clamp(elev*1.4+.1,0.,1.);

      vec3 zenithCol=mix(mix(nightZenith,dawnZenith,smoothstep(0.,.5,t)),dayZenith,smoothstep(.45,.8,t));
      vec3 horizonCol=mix(mix(nightHorizon,dawnHorizon,smoothstep(0.,.6,t)),dayHorizon,smoothstep(.55,.85,t));

      // Extra warm dawn glow near horizon
      float dawnGlow=dawnT*dawnT*clamp(1.-elev*3.,0.,1.);
      horizonCol=mix(horizonCol,vec3(1.0,0.4,0.05),dawnGlow*.8);

      vec3 skyCol=mix(horizonCol,zenithCol,skyT);

      // Sun contribution (Mie scattering)
      float sunDot=clamp(dot(dir,uSunDir),0.,1.);
      float sunDisk=pow(sunDot,860.); // sun disk
      float sunHalo=pow(sunDot,8.)*t*0.6; // atmospheric halo
      float sunGlow=pow(sunDot,25.)*t*0.35;
      vec3 sunColor=vec3(1.0,0.97,0.85);
      skyCol+=sunColor*(sunDisk*3.+sunHalo+sunGlow)*t;

      // Moon
      vec3 moonDir=vec3(-.6,.5,-.3);
      float moonDot=clamp(dot(dir,normalize(moonDir)),0.,1.);
      float moon=pow(moonDot,1200.)*(1.-t)*2.;
      skyCol+=vec3(.9,.95,1.0)*moon;

      // Stars (night only, simplified)
      float starAmt=clamp(1.-t*2.2,0.,1.);
      if(starAmt>0.01){
        float starNoise=fract(sin(dot(dir.xy+dir.z*.31,vec2(127.1,311.7)))*43758.5453);
        float stars=step(.992,starNoise)*starAmt*1.5;
        skyCol+=vec3(.85,.9,1.0)*stars;
      }

      // Below horizon: dark ocean/ground color
      if(elev<0.){
        skyCol=mix(skyCol,vec3(.01,.02,.04),clamp(-elev*8.,0.,1.));
      }

      gl_FragColor=vec4(skyCol,1.0);
    }
  `,
  side:THREE.BackSide,
  depthWrite:false,
});
const skyMesh=new THREE.Mesh(skyGeo,skyMat);
scene.add(skyMesh);

// ═══════════════════════════════════════
// TERRAIN — PlaneGeometry with displacement
// ═══════════════════════════════════════
const TERRAIN_SIZE=60000;
const TERRAIN_SEG=256;
const terrainGeo=new THREE.PlaneGeometry(TERRAIN_SIZE,TERRAIN_SIZE,TERRAIN_SEG,TERRAIN_SEG);
terrainGeo.rotateX(-Math.PI/2);

// Displace vertices using FBM
const pos=terrainGeo.attributes.position;
const SEED=Math.random()*100;
for(let i=0;i<pos.count;i++){
  const x=pos.getX(i);
  const z=pos.getZ(i);
  const nx=x/TERRAIN_SIZE*8+SEED;
  const nz=z/TERRAIN_SIZE*8+SEED;
  let h=fbm(nx,nz,7);
  h=h*h*Math.sign(h);
  h=Math.max(h,-.05);
  const worldH=h*3800;
  pos.setY(i,worldH);
}
terrainGeo.computeVertexNormals();

// Terrain material — vertex color based on height
const terrainColors=new Float32Array(pos.count*3);
for(let i=0;i<pos.count;i++){
  const y=pos.getY(i);
  let r,g,b;
  if(y<-50){r=.08;g=.16;b=.32;} // ocean floor
  else if(y<80){r=.78;g=.72;b=.52;} // sand
  else if(y<350){r=.22;g=.45;b=.18;} // grass
  else if(y<900){r=.15;g=.32;b=.12;} // forest
  else if(y<1800){r=.38;g=.33;b=.28;} // rocky
  else if(y<2800){r=.52;g=.50;b=.48;} // bare rock
  else{r=.92;g=.95;b=.98;} // snow
  terrainColors[i*3]=r;
  terrainColors[i*3+1]=g;
  terrainColors[i*3+2]=b;
}
terrainGeo.setAttribute('color',new THREE.BufferAttribute(terrainColors,3));

const terrainMat=new THREE.MeshLambertMaterial({
  vertexColors:true,
  fog:true,
});
const terrainMesh=new THREE.Mesh(terrainGeo,terrainMat);
terrainMesh.receiveShadow=true;
terrainMesh.castShadow=false;
scene.add(terrainMesh);

// ═══════════════════════════════════════
// OCEAN — Animated shader plane
// ═══════════════════════════════════════
const oceanGeo=new THREE.PlaneGeometry(TERRAIN_SIZE*2,TERRAIN_SIZE*2,1,1);
oceanGeo.rotateX(-Math.PI/2);
const oceanMat=new THREE.ShaderMaterial({
  uniforms:{
    uTime:{value:0},
    uDayPhase:{value:0.75},
    uSunDir:{value:new THREE.Vector3(.55,.72,.42).normalize()},
    uCamPos:{value:new THREE.Vector3()},
    uFogColor:{value:new THREE.Color(0x88bce8)},
    uFogDensity:{value:0.000045},
  },
  vertexShader:`
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal3;
    varying float vFogDepth;
    void main(){
      vUv=uv;
      vec4 wpos=modelMatrix*vec4(position,1.0);
      float wave=sin(wpos.x*.0004+uTime*1.2)*18.
               +sin(wpos.z*.0006+uTime*.9)*12.
               +sin((wpos.x+wpos.z)*.0003+uTime*1.5)*8.;
      wpos.y+=wave;
      vWorldPos=wpos.xyz;
      vNormal3=normalize(vec3(
        cos(wpos.x*.0004+uTime*1.2)*.0004*18.,
        1.0,
        cos(wpos.z*.0006+uTime*.9)*.0006*12.
      ));
      vec4 mvPos=viewMatrix*wpos;
      vFogDepth=-mvPos.z;
      gl_Position=projectionMatrix*mvPos;
    }
  `,
  fragmentShader:`
    uniform float uDayPhase;
    uniform vec3 uSunDir;
    uniform vec3 uCamPos;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal3;
    varying float vFogDepth;

    void main(){
      vec3 N=normalize(vNormal3);
      vec3 viewDir=normalize(uCamPos-vWorldPos);

      vec3 deepColor=vec3(0.01,0.05,0.18);
      vec3 shallowColor=vec3(0.02,0.18,0.42);
      float depth=clamp(dot(N,vec3(0,1,0)),0.,1.);
      vec3 waterColor=mix(deepColor,shallowColor,depth*.6+.2);

      float fresnel=pow(1.-clamp(dot(viewDir,N),0.,1.),3.5);

      vec3 dayReflection=vec3(.15,.45,.85);
      vec3 nightReflection=vec3(.01,.02,.06);
      vec3 skyRef=mix(nightReflection,dayReflection,uDayPhase);
      waterColor=mix(waterColor,skyRef,fresnel*.45);

      vec3 R=reflect(-uSunDir,N);
      float spec=pow(max(dot(viewDir,R),0.),180.)*uDayPhase;
      waterColor+=vec3(1.,.95,.7)*spec*.8;

      float foam=smoothstep(.8,1.,sin(vWorldPos.x*.002+uTime)*sin(vWorldPos.z*.0025+uTime*.8));
      waterColor=mix(waterColor,vec3(.92,.95,.98),foam*.25*uDayPhase);

      // Manual exponential fog (FogExp2)
      float fogFactor=exp(-uFogDensity*uFogDensity*vFogDepth*vFogDepth);
      fogFactor=clamp(fogFactor,0.0,1.0);
      waterColor=mix(uFogColor,waterColor,fogFactor);

      float alpha=mix(.88,.98,fresnel);
      gl_FragColor=vec4(waterColor,alpha);
    }
  `,
  transparent:true,
  fog:false,
});
const oceanMesh=new THREE.Mesh(oceanGeo,oceanMat);
oceanMesh.position.y=0;
oceanMesh.receiveShadow=false;
scene.add(oceanMesh);

// ═══════════════════════════════════════
// B-2 SPIRIT 3D MODEL
// ═══════════════════════════════════════
function makeB2(){
  const group=new THREE.Group();

  // Main wing body — extruded shape
  const wingShape=new THREE.Shape();
  wingShape.moveTo(0,-22);
  wingShape.lineTo(-13,-15);
  wingShape.lineTo(-26,-6);
  wingShape.lineTo(-38,-1);
  wingShape.lineTo(-40,2.5);
  wingShape.lineTo(-41,4);
  wingShape.lineTo(-34,8);
  wingShape.lineTo(-30,6);
  wingShape.lineTo(-24,10);
  wingShape.lineTo(-18,6);
  wingShape.lineTo(-13,10.5);
  wingShape.lineTo(-5,7);
  wingShape.lineTo(0,12);
  wingShape.lineTo(5,7);
  wingShape.lineTo(13,10.5);
  wingShape.lineTo(18,6);
  wingShape.lineTo(24,10);
  wingShape.lineTo(30,6);
  wingShape.lineTo(34,8);
  wingShape.lineTo(41,4);
  wingShape.lineTo(40,2.5);
  wingShape.lineTo(38,-1);
  wingShape.lineTo(26,-6);
  wingShape.lineTo(13,-15);
  wingShape.lineTo(0,-22);

  const extSettings={
    depth:2.2,
    bevelEnabled:true,
    bevelThickness:.8,
    bevelSize:.4,
    bevelSegments:3,
  };
  const wingGeo=new THREE.ExtrudeGeometry(wingShape,extSettings);

  // RAM coating — very dark, slightly blue-grey
  const wingMat=new THREE.MeshPhysicalMaterial({
    color:0x14142e,
    roughness:0.88,
    metalness:0.12,
    clearcoat:0.15,
    clearcoatRoughness:0.5,
  });
  const wing=new THREE.Mesh(wingGeo,wingMat);
  wing.rotation.x=Math.PI/2;
  wing.position.y=0;
  wing.castShadow=true;
  group.add(wing);

  // Cockpit canopy
  const cockpitGeo=new THREE.SphereGeometry(3.2,12,8,0,Math.PI*2,0,Math.PI*.45);
  const cockpitMat=new THREE.MeshPhysicalMaterial({
    color:0x1a3a6a,
    roughness:0.1,
    metalness:0.2,
    transmission:0.3,
    transparent:true,
    opacity:0.85,
  });
  const cockpit=new THREE.Mesh(cockpitGeo,cockpitMat);
  cockpit.position.set(0,1.5,-14);
  cockpit.rotation.x=Math.PI;
  group.add(cockpit);

  // Engine nacelles (4)
  [-16,-5.5,5.5,16].forEach(ex=>{
    const nGeo=new THREE.CylinderGeometry(1.4,1.2,6,10);
    const nMat=new THREE.MeshPhysicalMaterial({color:0x0a0a1a,roughness:.85,metalness:.15});
    const n=new THREE.Mesh(nGeo,nMat);
    n.position.set(ex,-.8,4);
    n.rotation.z=Math.PI/2;
    n.rotation.y=Math.PI/2;
    group.add(n);
  });

  // Engine glow sprites (4) — will be updated each frame
  const glowMat=new THREE.SpriteMaterial({
    color:0xff6600,
    transparent:true,
    opacity:0.0,
    blending:THREE.AdditiveBlending,
    depthWrite:false,
  });
  [-16,-5.5,5.5,16].forEach((ex,i)=>{
    const sp=new THREE.Sprite(glowMat.clone());
    sp.position.set(ex,-.8,7);
    sp.scale.set(8,8,8);
    sp.name='engineGlow'+i;
    group.add(sp);
  });

  group.scale.set(1.2,1.2,1.2);
  return group;
}

const b2Model=makeB2();
b2Model.visible=false;
scene.add(b2Model);

// ═══════════════════════════════════════
// ENEMY MODELS (simple fighter jets)
// ═══════════════════════════════════════
const targetObjects=[];

function makeEnemyMesh(type){
  const g=new THREE.Group();
  if(type==='enemy'){
    const mat=new THREE.MeshPhysicalMaterial({color:0x881111,roughness:.55,metalness:.35});
    const matDark=new THREE.MeshPhysicalMaterial({color:0x440808,roughness:.7,metalness:.2});
    const matCockpit=new THREE.MeshPhysicalMaterial({color:0x1a3a6a,roughness:.1,metalness:.3,transparent:true,opacity:.85});

    // Fuselage — tapered cylinder for nose shape
    const fGeo=new THREE.CylinderGeometry(1.1,1.8,16,10);
    const f=new THREE.Mesh(fGeo,mat); f.rotation.z=Math.PI/2; g.add(f);

    // Nose cone
    const nGeo=new THREE.ConeGeometry(1.1,6,10);
    const n=new THREE.Mesh(nGeo,matDark); n.rotation.z=-Math.PI/2; n.position.x=-11; g.add(n);

    // Main delta wings — use Shape for accuracy
    const wShape=new THREE.Shape();
    wShape.moveTo(0,0); wShape.lineTo(-8,0); wShape.lineTo(-2,12); wShape.lineTo(0,12);
    const wExt={depth:.4,bevelEnabled:false};
    const wGeoL=new THREE.ExtrudeGeometry(wShape,wExt);
    const wL=new THREE.Mesh(wGeoL,mat); wL.rotation.x=Math.PI/2; wL.position.set(2,-.2,0); g.add(wL);
    const wR=wL.clone(); wR.scale.z=-1; g.add(wR);

    // Horizontal stabilizers (rear)
    const hsGeo=new THREE.BoxGeometry(10,.3,4);
    const hs=new THREE.Mesh(hsGeo,mat); hs.position.set(6,0,0); g.add(hs);

    // Vertical tail fin
    const vtGeo=new THREE.BoxGeometry(4,5,.3);
    const vt=new THREE.Mesh(vtGeo,mat); vt.position.set(6,2.5,0); g.add(vt);

    // Cockpit canopy
    const cGeo=new THREE.SphereGeometry(1.5,8,6,0,Math.PI*2,0,Math.PI*.45);
    const cc=new THREE.Mesh(cGeo,matCockpit); cc.rotation.x=Math.PI; cc.position.set(-4,1.2,0); g.add(cc);

    // Engine exhaust
    const eGeo=new THREE.CylinderGeometry(1.5,1.2,3,8);
    const e=new THREE.Mesh(eGeo,matDark); e.rotation.z=Math.PI/2; e.position.set(9,0,0); g.add(e);

    // Engine glow sprite
    const eMat=new THREE.SpriteMaterial({color:0xff7700,transparent:true,opacity:.7,blending:THREE.AdditiveBlending,depthWrite:false});
    const esp=new THREE.Sprite(eMat); esp.position.set(12,0,0); esp.scale.set(5,5,5); esp.name='enemyGlow'; g.add(esp);

    g.scale.set(.7,.7,.7);
  } else {
    // Balloon — improved with more geometry
    const bGeo=new THREE.SphereGeometry(10,20,16);
    const bMat=new THREE.MeshPhysicalMaterial({color:0xffcc00,roughness:.4,metalness:.05,transparent:true,opacity:.92});
    const b=new THREE.Mesh(bGeo,bMat); g.add(b);
    // Vertical stripe
    const strGeo=new THREE.CylinderGeometry(10.05,10.05,8,.5,1,true,Math.PI*.1,Math.PI*.3);
    const strMat=new THREE.MeshBasicMaterial({color:0xff4400,side:THREE.DoubleSide});
    const str=new THREE.Mesh(strGeo,strMat); g.add(str);
    // Ropes
    for(let i=0;i<4;i++){
      const rGeo=new THREE.CylinderGeometry(.08,.08,14,4);
      const rMat=new THREE.MeshBasicMaterial({color:0x886633});
      const r=new THREE.Mesh(rGeo,rMat);
      r.position.set(Math.cos(i*Math.PI*.5)*5,-12,Math.sin(i*Math.PI*.5)*5);
      r.rotation.z=Math.sin(i*Math.PI*.5)*.4; r.rotation.x=Math.cos(i*Math.PI*.5)*.4;
      g.add(r);
    }
    const bkGeo=new THREE.BoxGeometry(6,4,6);
    const bkMat=new THREE.MeshLambertMaterial({color:0x8b5e2a});
    const bk=new THREE.Mesh(bkGeo,bkMat); bk.position.y=-17; g.add(bk);
    g.scale.set(.5,.5,.5);
  }
  return g;
}

// Bullet meshes pool
// Bullet geometries and materials — must be declared before pool init
const bulletGeo=new THREE.SphereGeometry(.8,6,6);
const bulletMat=new THREE.MeshBasicMaterial({color:0xffee66,blending:THREE.AdditiveBlending,depthWrite:false});
const missileMat=new THREE.MeshBasicMaterial({color:0xff8844,blending:THREE.AdditiveBlending,depthWrite:false});
const bombMat=new THREE.MeshBasicMaterial({color:0xaaaaaa,blending:THREE.AdditiveBlending,depthWrite:false});

// Bullet mesh pool — fixed size pool, assigned by bullet ID
let _bulletIdCounter=0;
const bulletPool=[]; // {mesh, mat, inUse, bulletId}
const BULLET_POOL_SIZE=80;
function _getBulletMat(type){
  if(type==='missile') return missileMat.clone();
  if(type==='bomb') return bombMat.clone();
  if(type==='ebullet') return new THREE.MeshBasicMaterial({color:0xff4466,blending:THREE.AdditiveBlending,depthWrite:false});
  return bulletMat.clone();
}
for(let i=0;i<BULLET_POOL_SIZE;i++){
  const mesh=new THREE.Mesh(bulletGeo,bulletMat.clone());
  mesh.visible=false;
  scene.add(mesh);
  bulletPool.push({mesh,inUse:false,bulletId:-1,type:'bullet'});
}
// Assign each bullet object a unique ID on creation
function _assignBulletId(b){if(b._id===undefined)b._id=_bulletIdCounter++;}
function _getPoolSlot(b){return bulletPool.find(s=>s.inUse&&s.bulletId===b._id);}
function _acquireSlot(b){
  let slot=bulletPool.find(s=>!s.inUse);
  if(!slot) return null;
  slot.inUse=true; slot.bulletId=b._id; slot.type=b.type;
  // Update material color
  slot.mesh.material.color.setHex(b.type==='missile'?0xff8844:b.type==='bomb'?0xaaaaaa:b.type==='ebullet'?0xff4466:0xffee66);
  return slot;
}
function _releaseUnusedBullets(activeBullets){
  const activeIds=new Set(activeBullets.map(b=>b._id));
  bulletPool.forEach(s=>{
    if(s.inUse&&!activeIds.has(s.bulletId)){
      s.inUse=false; s.bulletId=-1; s.mesh.visible=false;
    }
  });
}
// Explosion sprites
const explosionTexture=(()=>{
  const size=128;
  const data=new Uint8Array(size*size*4);
  for(let i=0;i<size;i++) for(let j=0;j<size;j++){
    const dx=i/size-.5, dy=j/size-.5;
    const r=Math.sqrt(dx*dx+dy*dy)*2;
    const v=Math.max(0,1-r)*Math.max(0,1-r);
    const idx=(i*size+j)*4;
    data[idx]=255;data[idx+1]=Math.round(200*v);data[idx+2]=0;data[idx+3]=Math.round(255*v);
  }
  const tex=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  tex.needsUpdate=true; return tex;
})();

const explosionPool=[];
for(let i=0;i<20;i++){
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({
    map:explosionTexture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  }));
  sp.visible=false;
  scene.add(sp);
  explosionPool.push({sp,active:false,t:0,x:0,y:0,z:0});
}

// Bullet trail geometry pool
const trailPool=[];
for(let i=0;i<60;i++){
  const tGeo=new THREE.BufferGeometry();
  const pts=new Float32Array(6);
  tGeo.setAttribute('position',new THREE.BufferAttribute(pts,3));
  const tMat=new THREE.LineBasicMaterial({color:0xffee66,transparent:true,opacity:.7,blending:THREE.AdditiveBlending,depthWrite:false});
  const line=new THREE.Line(tGeo,tMat);
  line.visible=false;
  scene.add(line);
  trailPool.push({line,active:false});
}

// Clouds
const cloudGroup=new THREE.Group();
scene.add(cloudGroup);
function makeCloud(x,y,z){
  const g=new THREE.Group();
  const n=4+Math.floor(Math.random()*5);
  const baseR=120+Math.random()*180;
  const cMat=new THREE.MeshLambertMaterial({color:0xeef4ff,transparent:true,opacity:.82,depthWrite:false,fog:true});
  for(let i=0;i<n;i++){
    const r=baseR*(0.5+Math.random()*.7);
    const sg=new THREE.SphereGeometry(r,10,7);
    const m=new THREE.Mesh(sg,cMat);
    m.position.set((Math.random()-.5)*baseR*2.2,(Math.random()-.5)*r*.5,(Math.random()-.5)*baseR*2.2);
    m.scale.y=0.5+Math.random()*.2;
    g.add(m);
  }
  g.position.set(x,y,z);
  return g;
}

// Init world
function initWorld3D(){
  // Clouds
  while(cloudGroup.children.length) cloudGroup.remove(cloudGroup.children[0]);
  [[20,2000,220],[15,4500,400],[10,7000,600]].forEach(([n,alt])=>{
    for(let i=0;i<n;i++){
      const cx=(Math.random()-.5)*20000;
      const cz=(Math.random()-.5)*20000;
      const c=makeCloud(cx,alt+(Math.random()-.5)*600,cz);
      cloudGroup.add(c);
    }
  });

  // Targets + Checkpoints
  spawnTargets3D();
  spawnCheckpoints();
}

// ═══════════════════════════════════════
// CHECKPOINTS
// ═══════════════════════════════════════
const cpObjects=[]; // {mesh, ring, type, collected, wx,wy,wz}
const CP_TYPES=['missiles','health']; // alternating types

function makeCheckpointMesh(type){
  const g=new THREE.Group();
  const col=type==='missiles'?0x4cc9f0:0x00ff88;
  // Outer rotating ring
  const rGeo=new THREE.TorusGeometry(22,1.8,10,32);
  const rMat=new THREE.MeshPhysicalMaterial({color:col,emissive:col,emissiveIntensity:.8,roughness:.3,metalness:.5});
  const ring=new THREE.Mesh(rGeo,rMat);
  ring.name='cpRing'; g.add(ring);
  // Inner ring
  const r2Geo=new THREE.TorusGeometry(14,1,8,24);
  const r2Mat=new THREE.MeshPhysicalMaterial({color:col,emissive:col,emissiveIntensity:.5,roughness:.4,metalness:.4,transparent:true,opacity:.7});
  const ring2=new THREE.Mesh(r2Geo,r2Mat);
  ring2.rotation.x=Math.PI/2; ring2.name='cpRing2'; g.add(ring2);
  // Center icon sprite
  const iconMat=new THREE.SpriteMaterial({color:col,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false});
  const icon=new THREE.Sprite(iconMat); icon.scale.set(20,20,20); icon.name='cpIcon'; g.add(icon);
  // Glow
  const glowMat=new THREE.SpriteMaterial({color:col,transparent:true,opacity:.25,blending:THREE.AdditiveBlending,depthWrite:false});
  const glow=new THREE.Sprite(glowMat); glow.scale.set(60,60,60); g.add(glow);
  return g;
}

function spawnCheckpoints(){
  // Clear old
  cpObjects.forEach(o=>{if(o.mesh)scene.remove(o.mesh);});
  cpObjects.length=0;
  S.checkpoints=[];
  S.cpCollected=[];
  // Spawn 6 checkpoints — alternating missiles/health
  for(let i=0;i<6;i++){
    const type=CP_TYPES[i%2];
    const cp={
      wx:(Math.random()-.5)*8000,
      wy:1500+Math.random()*3000,
      wz:(Math.random()-.5)*8000,
      type,collected:false,
      spinT:Math.random()*Math.PI*2,
    };
    S.checkpoints.push(cp);
    const mesh=makeCheckpointMesh(type);
    mesh.position.set(cp.wx,cp.wy,cp.wz);
    scene.add(mesh);
    cpObjects.push({cp,mesh});
  }
}

function updateCheckpoints(dt){
  cpObjects.forEach(({cp,mesh})=>{
    if(cp.collected){mesh.visible=false;return;}
    cp.spinT+=dt*1.2;
    mesh.visible=true;
    // Hover bob
    mesh.position.y=cp.wy+Math.sin(cp.spinT*.7)*30;
    // Rotate rings
    const ring=mesh.getObjectByName('cpRing');
    const ring2=mesh.getObjectByName('cpRing2');
    if(ring) ring.rotation.z=cp.spinT;
    if(ring) ring.rotation.x=Math.sin(cp.spinT*.4)*.5;
    if(ring2) ring2.rotation.y=cp.spinT*1.3;

    // Collect check
    const dx=S.planeX-cp.wx, dy=S.planeY-mesh.position.y, dz=S.planeZ-cp.wz;
    if(Math.sqrt(dx*dx+dy*dy+dz*dz)<120){
      cp.collected=true;
      if(cp.type==='missiles'){
        S.ammo.missiles=Math.min(S.ammo.missiles+6,12);
        S.ammo.bombs=Math.min(S.ammo.bombs+4,8);
        showPickupMsg('🚀 +6 טילים, +4 פצצות');
      } else {
        S.hp=Math.min(S.hp+35,100);
        showPickupMsg('❤️ +35 חיים');
      }
      S.score+=50;
      // Spawn explosion effect
      spawnExplosion(cp.wx,mesh.position.y,cp.wz);
    }
  });

  // Respawn collected checkpoints after 30s
  cpObjects.forEach(({cp,mesh})=>{
    if(cp.collected&&!cp.respawnTimer){
      cp.respawnTimer=30;
    }
    if(cp.respawnTimer){
      cp.respawnTimer-=dt;
      if(cp.respawnTimer<=0){
        cp.collected=false;
        cp.respawnTimer=null;
        cp.wx=(Math.random()-.5)*8000;
        cp.wy=1500+Math.random()*3000;
        cp.wz=(Math.random()-.5)*8000;
        mesh.position.set(cp.wx,cp.wy,cp.wz);
      }
    }
  });
}

// Pickup message
let _pickupMsg='', _pickupTimer=0;
function showPickupMsg(msg){
  _pickupMsg=msg; _pickupTimer=3;
  const el=q('pickup-msg');
  if(el){el.textContent=msg;el.style.opacity='1';}
}
function updatePickupMsg(dt){
  if(_pickupTimer>0){
    _pickupTimer-=dt;
    const el=q('pickup-msg');
    if(el) el.style.opacity=Math.min(_pickupTimer,1).toFixed(2);
    if(_pickupTimer<=0&&el) el.style.opacity='0';
  }
}

function spawnTargets3D(){
  // Remove old meshes from scene
  targetObjects.forEach(o=>{if(o.mesh)scene.remove(o.mesh);});
  targetObjects.length=0;
  S.targets=[];
  // Wave scaling: more enemies each wave
  const numEnemies=6+S.wave*2;
  const numBalloons=Math.max(2, 5-S.wave);
  S.enemiesThisWave=numEnemies;

  for(let i=0;i<numEnemies+numBalloons;i++){
    const type=i<numEnemies?'enemy':'balloon';
    const t={
      wx:(Math.random()-.5)*11000, wz:(Math.random()-.5)*11000,
      wy:800+Math.random()*5000,
      hp: type==='enemy'? 2+S.wave : 1,
      maxHp: type==='enemy'? 2+S.wave : 1,
      alive:true, type,
      t:Math.random()*Math.PI*2,
      speed:(20+Math.random()*60)*(1+S.wave*.15),
      heading:Math.random()*Math.PI*2,
      fireTimer:Math.random()*3,
      evading:false, evadeTimer:0,
      // Air combat: enemies try to get behind the player
      combatState:'approach', // 'approach'|'attack'|'evade'|'flank'
    };
    S.targets.push(t);
    const mesh=makeEnemyMesh(type);
    mesh.position.set(t.wx,t.wy,t.wz);
    scene.add(mesh);
    targetObjects.push({t,mesh});
  }
}

// ═══════════════════════════════════════
// UPDATE DAY/NIGHT
// ═══════════════════════════════════════
function updateDayNight(){
  const d=CFG.tod;
  // Sun direction
  const sunEl=d*Math.PI*.55;
  const sunAz=0.7;
  const sDir=new THREE.Vector3(Math.cos(sunAz)*Math.cos(sunEl),Math.sin(sunEl),Math.sin(sunAz)*Math.cos(sunEl)).normalize();
  skyMat.uniforms.uDayPhase.value=d;
  skyMat.uniforms.uSunDir.value.copy(sDir);
  oceanMat.uniforms.uDayPhase.value=d;
  oceanMat.uniforms.uSunDir.value.copy(sDir);
  // Lighting
  sunLight.color.setHSL(.1,1.,clamp(d*.9,.0,1.));
  sunLight.intensity=lerp3(0.1,2.5,d);
  sunLight.position.set(sDir.x*15000,sDir.y*18000,sDir.z*15000);
  ambLight.intensity=lerp3(.2,1.2,d);
  ambLight.color.setHSL(.6,.3,lerp3(.15,.5,d));
  hemiLight.intensity=lerp3(.1,.85,d);
  // Fog color
  const fogR=lerp3(.01,.55,d),fogG=lerp3(.02,.73,d),fogB=lerp3(.04,.92,d);
  scene.fog.color.setRGB(fogR,fogG,fogB);
  scene.fog.density=lerp3(.000085,.000040,d);
  // Sync ocean shader fog uniforms
  oceanMat.uniforms.uFogColor.value.setRGB(fogR,fogG,fogB);
  oceanMat.uniforms.uFogDensity.value=scene.fog.density;
  // Sky mesh follows camera
  skyMesh.position.copy(camera.position);
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

// ═══════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════
const camTarget3=new THREE.Vector3();
const camPos3=new THREE.Vector3();

function updateCamera3D(dt){
  const hr=S.heading*Math.PI/180, pr=S.pitch*Math.PI/180;
  const sm=1-Math.pow(.04,dt);
  const fwd=new THREE.Vector3(Math.sin(hr),Math.tan(pr),Math.cos(hr)).normalize();
  const planePos=new THREE.Vector3(S.planeX,S.planeY,S.planeZ);

  if(CFG.cam==='cockpit'){
    camera.position.copy(planePos);
    camera.position.y+=1.8;
    const lookAt=planePos.clone().add(fwd.clone().multiplyScalar(600));
    lookAt.y+=1.8;
    camera.lookAt(lookAt);
    camera.rotation.z=-S.roll*Math.PI/180;
    b2Model.visible=false;
    scene.fog.density=lerp3(scene.fog.density,.000038,sm);
  } else if(CFG.cam==='chase'){
    const offset=new THREE.Vector3(-Math.sin(hr)*90,28,-Math.cos(hr)*90);
    const tgt=planePos.clone().add(offset);
    camera.position.lerp(tgt,sm*2);
    camera.lookAt(planePos.clone().add(fwd.clone().multiplyScalar(80)));
    camera.up.set(0,1,0);
    b2Model.visible=true;
  } else if(CFG.cam==='external'){
    CFG.orbitAngle+=dt*.09;
    const od=280;
    const tgt=new THREE.Vector3(
      S.planeX+Math.sin(CFG.orbitAngle)*od,
      S.planeY+70,
      S.planeZ+Math.cos(CFG.orbitAngle)*od
    );
    camera.position.lerp(tgt,sm*2);
    camera.lookAt(planePos);
    camera.up.set(0,1,0);
    b2Model.visible=true;
  } else if(CFG.cam==='gun'){
    const goff=new THREE.Vector3(-Math.sin(hr)*12,Math.tan(pr)*(-12)+1,-Math.cos(hr)*12);
    camera.position.copy(planePos.clone().add(goff));
    const lookAt=planePos.clone().add(fwd.clone().multiplyScalar(500));
    camera.lookAt(lookAt);
    camera.rotation.z=-S.roll*Math.PI/180;
    b2Model.visible=false;
  } else { // orbit
    CFG.orbitAngle+=dt*.28;
    const od=320;
    camera.position.set(
      S.planeX+Math.sin(CFG.orbitAngle)*od*Math.cos(.4),
      S.planeY+85+Math.sin(.4)*160,
      S.planeZ+Math.cos(CFG.orbitAngle)*od*Math.cos(.4)
    );
    camera.lookAt(planePos);
    camera.up.set(0,1,0);
    b2Model.visible=true;
  }

  // Update B-2 model position/rotation
  if(b2Model.visible){
    b2Model.position.set(S.planeX,S.planeY,S.planeZ);
    b2Model.rotation.y=-S.heading*Math.PI/180+Math.PI;
    b2Model.rotation.x=S.pitch*Math.PI/180;
    b2Model.rotation.z=S.roll*Math.PI/180;
    // Engine glow
    const thr=S.throttle;
    const pulse=.7+Math.sin(S.time*8)*.3;
    b2Model.traverse(node=>{
      if(node.isSprite&&node.name&&node.name.startsWith('engineGlow')){
        node.material.opacity=(.2+thr*.6)*pulse;
        node.material.color.setRGB(1,.4+thr*.35,.05);
        const flameSize=6+thr*18*pulse;
        node.scale.set(flameSize,flameSize,flameSize);
      }
    });
  }

  // Update FOV
  camera.fov=CFG.fov;
  camera.updateProjectionMatrix();
  // Sky follows camera
  skyMesh.position.copy(camera.position);
  oceanMesh.position.x=camera.position.x;
  oceanMesh.position.z=camera.position.z;
}

// ═══════════════════════════════════════
// PHYSICS
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// GYROSCOPE (merged from Unity GyroFlightController)
// ═══════════════════════════════════════
const Gyro={
  available:false,
  calibrated:false,
  baseAlpha:0, baseBeta:0, baseGamma:0,
  pitch:0, roll:0,
  smoothing:0.15,
  deadzone:1.5,
  pitchCalibration:12, // degrees of neutral tilt
};

function initGyro(){
  if(typeof DeviceOrientationEvent==='undefined') return;
  // iOS 13+ requires permission
  if(typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(state=>{
      if(state==='granted') _attachGyro();
    }).catch(()=>{});
  } else {
    _attachGyro();
  }
}
function _attachGyro(){
  window.addEventListener('deviceorientation',e=>{
    if(!e.beta&&!e.gamma) return;
    Gyro.available=true;
    if(!Gyro.calibrated){
      Gyro.baseAlpha=e.alpha||0;
      Gyro.baseBeta =e.beta ||0;
      Gyro.baseGamma=e.gamma||0;
      Gyro.calibrated=true;
    }
    // Delta from calibration (like Quaternion.Inverse * current in Unity)
    let rawPitch=(e.beta -Gyro.baseBeta )-Gyro.pitchCalibration;
    let rawRoll =(e.gamma-Gyro.baseGamma);
    // Deadzone (matches gyroDeadzone in Unity script)
    rawPitch=Math.abs(rawPitch)>Gyro.deadzone?rawPitch-Math.sign(rawPitch)*Gyro.deadzone:0;
    rawRoll =Math.abs(rawRoll) >Gyro.deadzone?rawRoll -Math.sign(rawRoll) *Gyro.deadzone:0;
    // Smooth (lerp like in Unity FixedUpdate)
    Gyro.pitch=lerp(Gyro.pitch, clamp(rawPitch/45,-1,1), Gyro.smoothing);
    Gyro.roll =lerp(Gyro.roll,  clamp(rawRoll /45,-1,1), Gyro.smoothing);
    S.gyroActive=true;
  });
  const btn=q('gyro-btn');
  if(btn) btn.textContent='📱 ג\'ירו: ON';
}
function calibrateGyro(){
  Gyro.calibrated=false; // next event re-baselines
  showPickupMsg('📱 גירוסקופ כויל');
}

function updatePhysics(dt){
  dt=clamp(dt,.001,.05);

  // Input: gyro takes priority over joystick when active (Unity GyroFlightController style)
  let jx, jy;
  if(S.gyroActive && Gyro.available){
    jx= Gyro.roll  * CFG.sensitivity;
    jy=-Gyro.pitch * CFG.sensitivity; // invert: tilt forward = pitch down
  } else {
    jx=joy.dx/60*CFG.sensitivity;
    jy=joy.dy/60*CFG.sensitivity;
  }

  // Stall speed check (mirrors ComputeControlAuthority in Unity)
  const stallSpeed=82, fullCtrlSpeed=130;
  const authority=clamp((S.speed-stallSpeed)/(fullCtrlSpeed-stallSpeed),0,1);

  // Thrust & drag (mirrors ApplyThrust + ApplyAerodynamics)
  const minThrottle=0.2;
  const effectiveThrottle=lerp(minThrottle,1,S.throttle);
  const thrust=(effectiveThrottle*9-1.8)*dt;
  const drag=S.speed*S.speed*.0000018*dt;
  S.speed=clamp(S.speed+thrust-drag*S.speed,0,680);

  // Flight surfaces with authority scalar
  S.pitch=clamp(S.pitch+(-jy*1.45*dt*authority)*60,-75,75);
  S.roll =clamp(S.roll +(jx*2.25*dt*authority)*60,-78,78);
  if(!joy.active && !S.gyroActive){ S.roll*=.93; S.pitch*=.97; }

  // Coordinated yaw (auto-rudder, like yawAuthority in Unity)
  const yawRate=S.roll*0.022;
  S.heading=(S.heading+yawRate*dt*60+360)%360;

  // Vertical speed from pitch + lift (mirrors ApplyAerodynamics lift)
  const vs=S.pitch*S.speed*.165;
  S.vspeed=lerp(S.vspeed,vs,clamp(dt*3,0,1));
  S.altitude=clamp(S.altitude+S.vspeed*dt,0,42000);
  S.gForce=clamp(1+Math.abs(jy)*4*authority,.2,9);

  const hd=S.heading*Math.PI/180;
  S.planeX+=Math.sin(hd)*S.speed*dt*2;
  S.planeZ+=Math.cos(hd)*S.speed*dt*2;
  S.planeY=S.altitude;

  S.fuel=clamp(S.fuel-S.throttle*.015*dt,0,100);
  if(S.fuel<=0){S.throttle=0; S.speed=clamp(S.speed-1.5*dt,0,680);}

  if(S.altitude<=0){
    S.altitude=0;
    if(Math.abs(S.vspeed)>260||S.speed>185) damage(65+Math.abs(S.vspeed)*.055);
    else{ S.speed*=.88; S.vspeed=0; S.pitch*=.45; }
  }

  // Bullets — infinite for cannon (no life decrement on bullets, only time)
  S.bullets.forEach(b=>{
    b.x+=Math.sin(b.hr)*b.spd*dt; b.z+=Math.cos(b.hr)*b.spd*dt;
    b.y+=b.vy*dt; b.vy-=9.8*dt*(b.type==='bomb'?12:3);
    b.life-=dt;
    if(b.type==='bomb'&&b.y<=0){
      b.life=0;
      for(let k=0;k<4;k++) spawnExplosion(b.x+(Math.random()-.5)*120,5,b.z+(Math.random()-.5)*120);
    }
  });
  S.bullets=S.bullets.filter(b=>b.life>0);

  // Hit detection
  for(let bi=S.bullets.length-1;bi>=0;bi--){
    const b=S.bullets[bi];
    for(let ti=0;ti<S.targets.length;ti++){
      const t=S.targets[ti]; if(!t.alive) continue;
      const hitR=b.type==='bomb'?280:b.type==='missile'?200:140;
      const d2=Math.sqrt((b.x-t.wx)**2+(b.y-t.wy)**2+(b.z-t.wz)**2);
      if(d2<hitR){
        t.hp-=(b.type==='bomb'?3:b.type==='missile'?2:1);
        S.bullets.splice(bi,1);
        spawnExplosion(t.wx,t.wy,t.wz);
        if(t.hp<=0){
          t.alive=false;
          S.score+=t.type==='enemy'?200:100;
          if(t.type==='enemy') S.kills++;
          for(let k=0;k<3;k++) spawnExplosion(t.wx+(Math.random()-.5)*80,t.wy+(Math.random()-.5)*55,t.wz+(Math.random()-.5)*80);
        }
        break;
      }
    }
  }
  S.time+=dt; S.elapsed+=dt;
}

function spawnExplosion(x,y,z){
  const slot=explosionPool.find(e=>!e.active);
  if(!slot)return;
  slot.active=true;slot.t=0;slot.x=x;slot.y=y;slot.z=z;
  slot.sp.position.set(x,y,z);
  slot.sp.visible=true;
}

function updateExplosions(dt){
  explosionPool.forEach(e=>{
    if(!e.active)return;
    e.t+=dt*1.4;
    if(e.t>=1){e.active=false;e.sp.visible=false;return;}
    const al=1-e.t;
    const r=60*(e.t+.3);
    e.sp.scale.set(r,r,r);
    e.sp.material.opacity=al*.9;
    e.sp.material.color.setRGB(1,.5*(1-e.t),.0);
  });
}

// ═══════════════════════════════════════
// BULLET 3D UPDATE
// ═══════════════════════════════════════
function updateBullets3D(){
  // Assign IDs to new bullets
  [...S.bullets,...S.enemyBullets].forEach(b=>_assignBulletId(b));
  // Release slots for expired bullets
  _releaseUnusedBullets([...S.bullets,...S.enemyBullets]);

  // Hide all trail lines first
  trailPool.forEach(t=>{t.active=false;t.line.visible=false;});
  let trailIdx=0;

  // Update friendly bullets
  S.bullets.forEach(b=>{
    let slot=_getPoolSlot(b)||_acquireSlot(b);
    if(!slot) return;
    slot.mesh.position.set(b.x,b.y,b.z);
    slot.mesh.visible=true;
    const sc=b.type==='missile'?3.5:b.type==='bomb'?4:1.8;
    slot.mesh.scale.setScalar(sc);
    // Trail
    if(trailIdx<trailPool.length){
      const trail=trailPool[trailIdx++];
      trail.active=true; trail.line.visible=true;
      const pts=trail.line.geometry.attributes.position.array;
      pts[0]=b.x-Math.sin(b.hr)*80; pts[1]=b.y+b.vy*.06; pts[2]=b.z-Math.cos(b.hr)*80;
      pts[3]=b.x; pts[4]=b.y; pts[5]=b.z;
      trail.line.geometry.attributes.position.needsUpdate=true;
      trail.line.material.color.setHex(b.type==='missile'?0xff6600:0xffee66);
    }
  });

  // Update enemy bullets
  S.enemyBullets.forEach(b=>{
    let slot=_getPoolSlot(b)||_acquireSlot(b);
    if(!slot) return;
    slot.mesh.position.set(b.x,b.y,b.z);
    slot.mesh.visible=true;
    slot.mesh.scale.setScalar(2);
  });
}

// ═══════════════════════════════════════
// TARGET UPDATE
// ═══════════════════════════════════════
function updateTargets3D(dt){
  targetObjects.forEach(({t,mesh})=>{
    if(!t.alive){mesh.visible=false;return;}
    mesh.visible=true;
    mesh.position.set(t.wx,t.wy,t.wz);
    if(t.type==='enemy'){
      // Face heading direction
      mesh.rotation.y=-t.heading+Math.PI/2;
      // Bank into turns based on combat state
      const bankAmt = t.combatState==='flank'?0.7:t.combatState==='evade'?1.1:0.25;
      mesh.rotation.z=Math.sin(t.t*0.8)*bankAmt;
      mesh.rotation.x=Math.sin(t.t*0.5)*0.1;
      // Animate engine glow
      const glow=mesh.getObjectByName('enemyGlow');
      if(glow){
        const pulse=0.6+Math.sin(t.t*8)*0.4;
        glow.material.opacity=(0.4+pulse*0.5);
        const flameSize=4+pulse*3;
        glow.scale.set(flameSize,flameSize,flameSize);
      }
      // HP-based damage smoke (low hp = dark sprite)
      const hpRatio=t.hp/t.maxHp;
      if(hpRatio<0.4 && Math.random()<dt*3){
        spawnExplosion(t.wx+(Math.random()-.5)*8,t.wy,t.wz+(Math.random()-.5)*8);
      }
    } else {
      // Balloon sways
      mesh.rotation.y=t.t*.15;
      mesh.rotation.z=Math.sin(t.t*.6)*.08;
      mesh.position.y=t.wy+Math.sin(t.t*.5)*18;
    }
  });
}

// ═══════════════════════════════════════
// AI
// ═══════════════════════════════════════
function updateAI(dt){
  if(!CFG.ai)return;
  const diff=CFG.aiDiff;
  const diffMult=0.6+diff*0.25; // scales aggression

  S.targets.forEach(t=>{
    if(!t.alive||t.type!=='enemy')return;
    t.t+=dt;

    const dx=S.planeX-t.wx, dy=S.planeY-t.wy, dz=S.planeZ-t.wz;
    const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
    const dist2d=Math.sqrt(dx*dx+dz*dz);

    // ── Combat state machine (dogfighting) ────────────────────────────────
    // Mirrors GyroFlightController: approach → attack → flank → evade
    if(t.combatState==='approach'){
      // Fly toward player, match altitude
      const targetHd=Math.atan2(dx,dz);
      const hdDiff=targetHd-t.heading;
      t.heading+=Math.sin(hdDiff)*dt*diffMult*1.8;
      t.wy=lerp(t.wy, S.planeY+(Math.random()-.5)*400, dt*0.4);
      const spd=t.speed*dt*diffMult;
      t.wx+=Math.sin(t.heading)*spd*2.2;
      t.wz+=Math.cos(t.heading)*spd*2.2;
      if(dist<1200) t.combatState='attack';

    } else if(t.combatState==='attack'){
      // Lead-pursuit: aim slightly ahead of player movement
      const leadX=S.planeX+Math.sin(S.heading*Math.PI/180)*200;
      const leadZ=S.planeZ+Math.cos(S.heading*Math.PI/180)*200;
      const ldx=leadX-t.wx, ldz=leadZ-t.wz;
      const aimHd=Math.atan2(ldx,ldz);
      const hdDiff=aimHd-t.heading;
      t.heading+=Math.sin(hdDiff)*dt*diffMult*2.2;
      // Match player altitude closely during attack
      t.wy=lerp(t.wy, S.planeY+80, dt*0.7);
      const spd=t.speed*dt*(0.9+diff*0.12);
      t.wx+=Math.sin(t.heading)*spd*2.5;
      t.wz+=Math.cos(t.heading)*spd*2.5;

      // Fire when roughly aligned
      t.fireTimer-=dt;
      const aimErr=Math.abs(Math.sin(hdDiff));
      if(t.fireTimer<=0 && dist<1400+diff*350 && aimErr<0.35){
        t.fireTimer=(3.8-diff*0.5)+Math.random();
        // Lead-compensated shot
        S.enemyBullets.push({
          x:t.wx, y:t.wy, z:t.wz,
          hr:Math.atan2(leadX-t.wx, leadZ-t.wz),
          vy:(S.planeY-t.wy)/(dist||1)*520,
          spd:680+diff*90, life:3.8,
        });
      }
      // Switch to flank if player is too close (break turn)
      if(dist<400) t.combatState='flank';
      if(dist>1800) t.combatState='approach';

    } else if(t.combatState==='flank'){
      // Break-turn: turn hard perpendicular, gain separation
      t.heading+=dt*diffMult*3.5*(t.t%2<1?1:-1);
      t.wy=lerp(t.wy, t.wy+(Math.random()-.5)*800, dt*1.2);
      t.wy=clamp(t.wy,300,8000);
      const spd=t.speed*dt*1.4;
      t.wx+=Math.sin(t.heading)*spd*2.8;
      t.wz+=Math.cos(t.heading)*spd*2.8;
      t.evadeTimer=(t.evadeTimer||0)+dt;
      if(t.evadeTimer>1.5+Math.random()){t.combatState='approach';t.evadeTimer=0;}

    } else if(t.combatState==='evade'){
      // Random jinking — hard to track
      t.heading+=Math.sin(t.t*5.5)*dt*diffMult*4;
      t.wy+=Math.cos(t.t*3.2)*dt*300;
      t.wy=clamp(t.wy,300,8000);
      const spd=t.speed*dt*1.6;
      t.wx+=Math.sin(t.heading)*spd*3;
      t.wz+=Math.cos(t.heading)*spd*3;
      t.evadeTimer=(t.evadeTimer||0)+dt;
      if(t.evadeTimer>2+Math.random()*1.5){t.combatState='approach';t.evadeTimer=0;}
    }

    // Random evade trigger (simulate defensive manoeuvre)
    if(Math.random()<dt*0.04*diff && t.combatState!=='evade'){
      t.combatState='evade'; t.evadeTimer=0;
    }

    // Keep in world bounds
    t.wx=clamp(t.wx,-13000,13000); t.wz=clamp(t.wz,-13000,13000);
    t.wy=clamp(t.wy,300,9000);
  });

  // ── Enemy bullets physics ────────────────────────────────────────────────
  S.enemyBullets.forEach(b=>{
    b.x+=Math.sin(b.hr)*b.spd*dt;
    b.z+=Math.cos(b.hr)*b.spd*dt;
    b.y+=b.vy*dt;
    b.life-=dt;
  });
  S.enemyBullets=S.enemyBullets.filter(b=>{
    if(b.life<=0)return false;
    const d2=Math.sqrt((b.x-S.planeX)**2+(b.y-S.planeY)**2+(b.z-S.planeZ)**2);
    if(d2<55){damage(2+diff);return false;}
    return true;
  });

  // ── Wave completion check ───────────────────────────────────────────────
  const aliveEnemies=S.targets.filter(t=>t.alive&&t.type==='enemy').length;
  if(aliveEnemies===0 && S.targets.length>0 && gameRunning){
    S.wave++;
    S.score+=500*S.wave;
    showPickupMsg(`🌊 גל ${S.wave}! +${500*S.wave} נקודות`);
    setTimeout(()=>{
      spawnTargets3D();
      spawnCheckpoints();
    }, 3000);
  }
}

// ═══════════════════════════════════════
// MISSILE LOCK (screen-space)
// ═══════════════════════════════════════
function updateMissileLock(){
  if(currentWep!==1){S.lockedTarget=null;S.missileLock=false;return;}
  let best=null,bestScore=Infinity;
  const W=window.innerWidth,H=window.innerHeight;
  S.targets.forEach(t=>{
    if(!t.alive||t.type!=='enemy')return;
    const v=new THREE.Vector3(t.wx,t.wy,t.wz).project(camera);
    if(v.z>1)return;
    const sx=(v.x*.5+.5)*W, sy=(-v.y*.5+.5)*H;
    const dist=Math.sqrt((sx-W/2)**2+(sy-H/2)**2);
    if(dist<130&&dist<bestScore){best=t;bestScore=dist;}
  });
  S.lockedTarget=best;S.missileLock=!!best;
  const ml=document.getElementById('mlock');
  if(ml)ml.style.display=best?'block':'none';
}

// ═══════════════════════════════════════
// HUD
// ═══════════════════════════════════════
const DIRS=['צפון','צ-מז','מזרח','ד-מז','דרום','ד-מע','מערב','צ-מע'];
function q(id){return document.getElementById(id);}
function updateHUD(){
  q('sv').textContent=String(Math.round(S.speed)).padStart(3,'0');
  q('av').textContent=String(Math.round(S.altitude)).padStart(4,'0');
  q('mv').textContent=(S.speed/1235).toFixed(2);
  q('ch').textContent=String(Math.round(S.heading)).padStart(3,'0')+'°';
  q('cd').textContent=DIRS[Math.round(S.heading/45)%8];
  q('scv').textContent=S.score;
  q('vsv').textContent=(S.vspeed>=0?'+':'')+Math.round(S.vspeed);
  q('gv').textContent=S.gForce.toFixed(1)+'G';
  q('kv').textContent=S.kills;
  const m2=Math.floor(S.elapsed/60),s2=Math.floor(S.elapsed%60);
  q('tv').textContent=String(m2).padStart(2,'0')+':'+String(s2).padStart(2,'0');
  const hf=q('hpf');if(hf){hf.style.width=S.hp+'%';hf.style.background=S.hp>50?'#00ff88':S.hp>25?'#ffbe0b':'#ff3344';}
  const ff=q('fuf');if(ff){ff.style.width=S.fuel+'%';ff.style.background=S.fuel>30?'#4cc9f0':'#ff3344';}
  const pct=Math.round(S.throttle*100);
  const tp=q('thrpct');if(tp)tp.textContent=pct+'%';
  const tf=q('thrfill');if(tf)tf.style.height=pct+'%';
  const th=q('thrhandle');if(th)th.style.bottom=pct+'%';
  const gl2=q('gl'),gt=q('gt');
  if(gl2){const gc=S.gearDown?'#00ff88':'#ff3344';gl2.style.color=gc;}
  if(gt)gt.textContent=S.gearDown?'DOWN':'UP';
  // Ammo: show ∞ for cannon
  const el0=q('ammo-bullets'); if(el0) el0.textContent='∞';
  const el1=q('ammo-missiles');if(el1) el1.textContent=S.ammo.missiles;
  const el2=q('ammo-bombs');   if(el2) el2.textContent=S.ammo.bombs;
  ['slot-bullets','slot-missiles','slot-bombs'].forEach((id,i)=>{
    const el=q(id);if(!el)return;
    el.classList.toggle('sel',i===currentWep);
    // Only missiles/bombs can be empty
    el.classList.toggle('empty',i>0&&S.ammo[WEP_MODES[i]]<=0);
  });
  q('wepmode').textContent=WEP_NAMES[currentWep];
  // Wave display
  const wv=q('wave-val'); if(wv) wv.textContent=S.wave;
  const ae=q('enemies-val');if(ae) ae.textContent=S.targets.filter(t=>t.alive&&t.type==='enemy').length;
  // Warnings
  const stallSpeed=82;
  q('w-stall')?.classList.toggle('on',S.speed<stallSpeed&&S.altitude>55);
  q('w-over')?.classList.toggle('on',S.speed>490);
  q('w-pull')?.classList.toggle('on',S.altitude<480&&S.vspeed<-620);
  q('w-fuel')?.classList.toggle('on',S.fuel<15);
  q('w-lock')?.classList.toggle('on',S.missileLock&&currentWep===1);
  q('w-ammo')?.classList.toggle('on',S.ammo.missiles<=0&&S.ammo.bombs<=0&&currentWep!==0);
  const gpws=q('gpws');if(gpws)gpws.style.display=S.altitude<180&&S.vspeed<-240?'block':'none';
  const adi=document.getElementById('adi-bg');if(adi)adi.style.transform=`rotate(${S.roll}deg)`;
  const xh=q('xhair');if(xh)xh.style.display=(CFG.cam==='cockpit'||CFG.cam==='gun')?'block':'none';
  const mxh=q('mxhair');if(mxh)mxh.style.display=(currentWep===1&&(CFG.cam==='cockpit'||CFG.cam==='gun'))?'block':'none';
  const posv=q('posv');if(posv)posv.textContent=`${Math.round(S.planeX/100)},${Math.round(S.planeZ/100)}`;
  const statv=q('statv');if(statv){
    const stallSpeed2=82;
    const st=S.speed<stallSpeed2?'⚠ STALL':S.speed>400?'SUPERSONIC':S.speed>250?'HIGH SPEED':S.altitude>10000?'HIGH ALT':'CRUISE';
    statv.textContent=st;
    statv.style.color=S.speed<stallSpeed2?'#ff3344':'#4cc9f0';
  }
  // Gyro indicator
  const gyroEl=q('gyro-btn');
  if(gyroEl && S.gyroActive) gyroEl.textContent="📱 ג'ירו: ON";
}

// ═══════════════════════════════════════
// RADAR
// ═══════════════════════════════════════
function drawRadar(){
  const rc=document.getElementById('rcanvas');if(!rc)return;
  const rctx=rc.getContext('2d');
  const W2=120,H2=120,cx=60,cy=60,rad=55;
  rctx.clearRect(0,0,W2,H2);
  rctx.fillStyle='rgba(0,15,8,.9)';rctx.beginPath();rctx.arc(cx,cy,rad,0,Math.PI*2);rctx.fill();
  [55,38,22].forEach(r=>{rctx.strokeStyle=`rgba(0,255,136,${r===55?.3:.18})`;rctx.lineWidth=.8;rctx.beginPath();rctx.arc(cx,cy,r,0,Math.PI*2);rctx.stroke();});
  rctx.strokeStyle='rgba(0,255,136,.15)';rctx.lineWidth=.6;
  rctx.beginPath();rctx.moveTo(cx-rad,cy);rctx.lineTo(cx+rad,cy);rctx.stroke();
  rctx.beginPath();rctx.moveTo(cx,cy-rad);rctx.lineTo(cx,cy+rad);rctx.stroke();
  const sweep=(S.time*.8)%(Math.PI*2);
  rctx.strokeStyle='rgba(0,255,136,.5)';rctx.lineWidth=1.5;
  rctx.beginPath();rctx.moveTo(cx,cy);rctx.lineTo(cx+Math.sin(sweep)*rad,cy-Math.cos(sweep)*rad);rctx.stroke();
  rctx.save();rctx.globalAlpha=.18;rctx.fillStyle='rgba(0,255,136,.35)';
  rctx.beginPath();rctx.moveTo(cx,cy);
  for(let a=sweep-Math.PI*.35;a<=sweep;a+=.08)rctx.lineTo(cx+Math.sin(a)*rad,cy-Math.cos(a)*rad);
  rctx.closePath();rctx.fill();rctx.restore();
  const RADR=2500;
  S.targets.forEach(t=>{
    if(!t.alive)return;
    const dx=(t.wx-S.planeX)/RADR*rad,dz=(t.wz-S.planeZ)/RADR*rad;
    const hr2=S.heading*Math.PI/180;
    const rx=dx*Math.cos(hr2)+dz*Math.sin(hr2),rz=-dx*Math.sin(hr2)+dz*Math.cos(hr2);
    const bx=clamp(cx+rx,cx-rad+4,cx+rad-4),bz=clamp(cy+rz,cy-rad+4,cy+rad-4);
    rctx.fillStyle=t.type==='enemy'?'#ff3344':'#ffbe0b';
    rctx.shadowBlur=4;rctx.shadowColor=t.type==='enemy'?'#ff0022':'#ffaa00';
    rctx.beginPath();rctx.arc(bx,bz,3,0,Math.PI*2);rctx.fill();rctx.shadowBlur=0;
  });
  rctx.fillStyle='#00ff88';rctx.beginPath();rctx.arc(cx,cy,3,0,Math.PI*2);rctx.fill();
  rctx.strokeStyle='rgba(0,255,136,.35)';rctx.lineWidth=1.2;rctx.beginPath();rctx.arc(cx,cy,rad,0,Math.PI*2);rctx.stroke();
}

// ═══════════════════════════════════════
// SHOOT / DAMAGE
// ═══════════════════════════════════════
function fire(){
  if(!gameRunning) return;
  const wk=WEP_MODES[currentWep];
  // Infinite bullets — only missiles and bombs are limited
  if(currentWep!==0 && S.ammo[wk]<=0) return;
  if(currentWep!==0) S.ammo[wk]--;

  const hr=S.heading*Math.PI/180, pr2=S.pitch*Math.PI/180;
  if(currentWep===0){
    // Cannon: always fires, no ammo cost
    S.bullets.push({x:S.planeX,y:S.planeY,z:S.planeZ,hr,vy:Math.sin(pr2)*1350,spd:1350,life:3.2,type:'bullet'});
  } else if(currentWep===1){
    S.bullets.push({x:S.planeX,y:S.planeY,z:S.planeZ,hr,vy:Math.sin(pr2)*900,spd:950,life:5,type:'missile',target:S.lockedTarget});
  } else {
    S.bullets.push({x:S.planeX,y:S.planeY,z:S.planeZ,hr,vy:-30,spd:S.speed*.5,life:8,type:'bomb'});
  }
  const fl=document.createElement('div'); fl.className='flash-el';
  fl.style.left=(window.innerWidth/2-30)+'px'; fl.style.top=(window.innerHeight/2-30)+'px';
  document.body.appendChild(fl); setTimeout(()=>fl.remove(),220);
}
function damage(amt){
  S.hp=clamp(S.hp-amt,0,100);
  const el=q('expl');
  if(el){el.style.background='radial-gradient(circle,rgba(255,90,0,.72),transparent 70%)';el.style.display='block';el.style.animation='none';requestAnimationFrame(()=>{el.style.animation='expanim .42s ease-out forwards';});setTimeout(()=>{el.style.display='none';},440);}
  if(S.hp<=0)gameOver();
}

// ═══════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════
let lastT=0;
function gameLoop(ts){
  if(!gameRunning)return;
  const dt=clamp((ts-lastT)/1000,.001,.05);lastT=ts;
  updatePhysics(dt);
  updateAI(dt);
  updateMissileLock();
  updateCamera3D(dt);
  updateDayNight();
  updateTargets3D(dt);
  updateBullets3D();
  updateExplosions(dt);
  updateCheckpoints(dt);
  updatePickupMsg(dt);
  updateHUD();
  drawRadar();
  // Animate ocean/sky time
  oceanMat.uniforms.uTime.value=S.time;
  skyMat.uniforms.uTime.value=S.time;
  oceanMat.uniforms.uCamPos.value.copy(camera.position);
  // Clouds visibility toggle
  cloudGroup.visible=CFG.clouds;
  terrainMesh.visible=CFG.mountains;
  oceanMesh.visible=CFG.waves;
  // Render
  renderer.render(scene,camera);
  requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════
// START SCREEN ANIMATION
// ═══════════════════════════════════════
const sc2el=document.getElementById('sc2');let sc2ctx,stT=0;
function initStartAnim(){
  if(!sc2el)return;
  sc2el.width=window.innerWidth;sc2el.height=window.innerHeight;
  sc2ctx=sc2el.getContext('2d');
  animStart();
}
function animStart(){
  if(gameRunning||!sc2ctx)return;
  stT+=.006;
  const W2=sc2el.width,H2=sc2el.height;
  sc2ctx.fillStyle='#000408';sc2ctx.fillRect(0,0,W2,H2);
  for(let i=0;i<280;i++){
    const sx=((Math.sin(i*432.1+stT*.007)*.5+.5)*W2),sy=((Math.cos(i*231.7)*.5+.5)*H2*.52);
    sc2ctx.globalAlpha=(Math.sin(stT*2.5+i)*.3+.7)*.52;sc2ctx.fillStyle='#fff';
    sc2ctx.beginPath();sc2ctx.arc(sx,sy,Math.pow(Math.random(),3)*.9+.15,0,Math.PI*2);sc2ctx.fill();
  }
  sc2ctx.globalAlpha=1;
  // B-2 silhouette
  const cx2=W2*.5+Math.sin(stT*.27)*W2*.09,cy2=H2*.38+Math.sin(stT*.52)*H2*.04;
  const s=Math.min(W2,H2)*.18;
  sc2ctx.save();sc2ctx.translate(cx2,cy2);sc2ctx.rotate(Math.sin(stT*.44)*.13);
  const h2=sc2ctx.createRadialGradient(0,0,s*.2,0,0,s*3.8);
  h2.addColorStop(0,`rgba(0,175,255,.18)`);h2.addColorStop(1,'rgba(0,0,28,0)');
  sc2ctx.fillStyle=h2;sc2ctx.beginPath();sc2ctx.ellipse(0,0,s*3.8,s*1.7,0,0,Math.PI*2);sc2ctx.fill();
  sc2ctx.beginPath();
  sc2ctx.moveTo(0,-s*.56);sc2ctx.lineTo(-s*.34,-s*.38);sc2ctx.lineTo(-s*.7,-s*.15);sc2ctx.lineTo(-s*1.0,s*.04);sc2ctx.lineTo(-s*1.06,s*.09);sc2ctx.lineTo(-s*.89,s*.23);sc2ctx.lineTo(-s*.62,s*.10);sc2ctx.lineTo(-s*.38,s*.29);sc2ctx.lineTo(-s*.13,s*.19);sc2ctx.lineTo(0,s*.31);sc2ctx.lineTo(s*.13,s*.19);sc2ctx.lineTo(s*.38,s*.29);sc2ctx.lineTo(s*.62,s*.10);sc2ctx.lineTo(s*.89,s*.23);sc2ctx.lineTo(s*1.06,s*.09);sc2ctx.lineTo(s*1.0,s*.04);sc2ctx.lineTo(s*.7,-s*.15);sc2ctx.lineTo(s*.34,-s*.38);sc2ctx.closePath();
  const wg2=sc2ctx.createLinearGradient(0,-s*.56,0,s*.31);wg2.addColorStop(0,'#26265a');wg2.addColorStop(.42,'#18183e');wg2.addColorStop(1,'#0d0d22');
  sc2ctx.fillStyle=wg2;sc2ctx.fill();sc2ctx.strokeStyle=`rgba(0,218,255,${.5+Math.sin(stT*1.3)*.2})`;sc2ctx.lineWidth=2.2;sc2ctx.stroke();
  sc2ctx.restore();
  requestAnimationFrame(animStart);
}

// ═══════════════════════════════════════
// INPUT
// ═══════════════════════════════════════
const jzone=document.getElementById('jzone'),jbase=document.getElementById('jbase'),jknob=document.getElementById('jknob'),JR=55;
function gjp(e){const t=(e.touches&&e.touches[0])||(e.changedTouches&&e.changedTouches[0])||e;return{x:t.clientX,y:t.clientY};}
if(jzone&&jbase&&jknob){
  const onS=e=>{const p=gjp(e),r=jbase.getBoundingClientRect();joy.active=true;joy.sx=r.left+r.width/2;joy.sy=r.top+r.height/2;joy.dx=clamp(p.x-joy.sx,-JR,JR);joy.dy=clamp(p.y-joy.sy,-JR,JR);jknob.classList.add('on');};
  const onM=e=>{if(!joy.active)return;const p=gjp(e);let dx=p.x-joy.sx,dy=p.y-joy.sy;const d=Math.sqrt(dx*dx+dy*dy);if(d>JR){dx=dx/d*JR;dy=dy/d*JR;}joy.dx=dx;joy.dy=dy;jknob.style.left=(50+dx/JR*38)+'%';jknob.style.top=(50+dy/JR*38)+'%';};
  const onE=e=>{joy.active=false;joy.dx=0;joy.dy=0;jknob.style.left='50%';jknob.style.top='50%';jknob.classList.remove('on');};
  jzone.addEventListener('touchstart',e=>{e.preventDefault();onS(e);},{passive:false});
  jzone.addEventListener('touchmove',e=>{e.preventDefault();onM(e);},{passive:false});
  jzone.addEventListener('touchend',e=>{e.preventDefault();onE(e);},{passive:false});
  jzone.addEventListener('mousedown',onS);window.addEventListener('mousemove',onM);window.addEventListener('mouseup',onE);
}
const ttrack=document.getElementById('thrtrack');
function hThr(e){const r=ttrack.getBoundingClientRect(),t=e.touches?e.touches[0]:e;S.throttle=clamp(1-(t.clientY-r.top)/r.height,0,1);}
let thrDrag2=false;
if(ttrack){
  ttrack.addEventListener('touchstart',e=>{e.preventDefault();thrDrag2=true;hThr(e);},{passive:false});
  ttrack.addEventListener('mousedown',e=>{thrDrag2=true;hThr(e);});
  window.addEventListener('touchmove',e=>{if(thrDrag2){e.preventDefault();hThr(e);}},{passive:false});
  window.addEventListener('mousemove',e=>{if(thrDrag2)hThr(e);});
  window.addEventListener('touchend',()=>{thrDrag2=false;});window.addEventListener('mouseup',()=>{thrDrag2=false;});
}
document.getElementById('bfire')?.addEventListener('touchstart',e=>{e.preventDefault();fire();},{passive:false});
document.getElementById('bfire')?.addEventListener('mousedown',fire);
document.getElementById('bwep')?.addEventListener('touchstart',e=>{e.preventDefault();cycleWeapon();},{passive:false});
document.getElementById('bwep')?.addEventListener('mousedown',cycleWeapon);

document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='Space'){e.preventDefault();fire();}
  if(e.code==='KeyV'){e.preventDefault();cycleCamera();}
  if(e.code==='Digit1')setWeapon(0);if(e.code==='Digit2')setWeapon(1);if(e.code==='Digit3')setWeapon(2);
  if(e.code==='KeyG') S.gearDown=!S.gearDown;
  if(e.code==='KeyC') calibrateGyro();
  if(e.code==='Escape')toggleSettings();
});
document.addEventListener('keyup',e=>{keys[e.code]=false;});
setInterval(()=>{
  if(!gameRunning)return;
  const spd=2.8;
  if(keys['ArrowUp']){joy.active=true;joy.dy=clamp(joy.dy-spd,-JR,JR);}
  else if(keys['ArrowDown']){joy.active=true;joy.dy=clamp(joy.dy+spd,-JR,JR);}
  if(keys['ArrowLeft']){joy.active=true;joy.dx=clamp(joy.dx-spd,-JR,JR);}
  else if(keys['ArrowRight']){joy.active=true;joy.dx=clamp(joy.dx+spd,-JR,JR);}
  if(!keys['ArrowUp']&&!keys['ArrowDown'])joy.dy*=.82;
  if(!keys['ArrowLeft']&&!keys['ArrowRight'])joy.dx*=.82;
  if(!keys['ArrowUp']&&!keys['ArrowDown']&&!keys['ArrowLeft']&&!keys['ArrowRight'])joy.active=false;
  if(keys['KeyW'])S.throttle=clamp(S.throttle+.005,0,1);
  if(keys['KeyS'])S.throttle=clamp(S.throttle-.005,0,1);
},16);

// ═══════════════════════════════════════
// CAMERA & WEAPON CYCLE
// ═══════════════════════════════════════
function cycleCamera(){const i=(CAM_MODES.indexOf(CFG.cam)+1)%CAM_MODES.length;setCamera(CAM_MODES[i]);}
function setCamera(mode){
  CFG.cam=mode;
  const i=CAM_MODES.indexOf(mode);
  q('camlbl').textContent=CAM_LABELS[i];
  q('camBtn').textContent='📷 '+CAM_LABELS[i]+' ▾';
  document.querySelectorAll('.cbtn').forEach(b=>b.classList.toggle('sel',b.dataset.cam===mode));
}
function cycleWeapon(){setWeapon((currentWep+1)%3);}
function setWeapon(i){currentWep=i;}
function toggleSettings(){
  const s=document.getElementById('sett');
  if(!s.style.display||s.style.display==='none')s.style.display='block';
  s.classList.toggle('open');
}
document.getElementById('settBtn')?.addEventListener('click',toggleSettings);
document.getElementById('camBtn')?.addEventListener('click',cycleCamera);
document.querySelectorAll('.cbtn').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.cam)));
document.querySelectorAll('.qbtn').forEach(b=>b.addEventListener('click',()=>{
  const q2=parseFloat(b.dataset.q);
  renderer.setPixelRatio((window.devicePixelRatio||1)*q2);
  document.querySelectorAll('.qbtn').forEach(bb=>bb.classList.toggle('sel',bb===b));
}));
function setTog(id,key){
  const el=document.getElementById(id);if(!el)return;
  if(CFG[key])el.classList.add('on'); else el.classList.remove('on');
  el.addEventListener('click',()=>{CFG[key]=!CFG[key];el.classList.toggle('on',CFG[key]);});
}
setTog('tog-clouds','clouds');setTog('tog-mnt','mountains');setTog('tog-waves','waves');setTog('tog-bloom','bloom');setTog('tog-ai','ai');setTog('tog-stars','stars');
document.getElementById('fovs')?.addEventListener('input',function(){CFG.fov=parseInt(this.value);document.getElementById('fovlbl').textContent=CFG.fov+'°';});
document.getElementById('senss')?.addEventListener('input',function(){CFG.sensitivity=parseInt(this.value)/10;document.getElementById('senslbl').textContent=CFG.sensitivity.toFixed(1)+'x';});
document.getElementById('tods')?.addEventListener('input',function(){CFG.tod=parseInt(this.value)/100;});
document.getElementById('diffs')?.addEventListener('input',function(){CFG.aiDiff=parseInt(this.value);document.getElementById('difflbl').textContent=this.value;});

// ═══════════════════════════════════════
// COMPASS STRIP
// ═══════════════════════════════════════
(function(){
  const inn=document.getElementById('cstripIn');if(!inn)return;
  for(let i=0;i<72;i++){
    const deg=i*5;
    const d2=document.createElement('div');d2.className='ctk'+(deg%90===0?' maj':'');d2.style.width='22px';
    d2.innerHTML=`<div class="ctl"></div><span>${deg%30===0?(deg%90===0?['N','E','S','W'][deg/90%4]:deg):''}</span>`;
    inn.appendChild(d2);
  }
  function updateC(){if(inn)inn.style.transform=`translateX(calc(-50% - ${S.heading/360*22*72}px))`;requestAnimationFrame(updateC);}
  updateC();
})();

// ═══════════════════════════════════════
// START / GAME OVER
// ═══════════════════════════════════════
function showUI(){
  q('hud').style.display='block'; q('ctrl').style.display='block';
  q('camBtn').style.display='block'; q('camlbl').style.display='block';
  q('settBtn').style.display='block'; q('radar').style.display='block';
  q('gyro-btn').style.display='block';
  document.querySelectorAll('.corner').forEach(c=>c.style.display='block');
}
function startGame(){
  if(gameRunning)return;
  resetState();
  q('ss').style.display='none'; q('go').style.display='none';
  showUI(); setCamera('cockpit');
  initWorld3D();
  initGyro(); // start gyroscope if available
  gameRunning=true; lastT=performance.now();
  requestAnimationFrame(gameLoop);
}
function gameOver(){
  gameRunning=false;
  q('hud').style.display='none'; q('ctrl').style.display='none';
  q('camBtn').style.display='none'; q('camlbl').style.display='none';
  q('settBtn').style.display='none'; q('radar').style.display='none';
  q('gyro-btn').style.display='none';
  document.querySelectorAll('.corner').forEach(c=>c.style.display='none');
  q('go').style.display='flex';
  q('fscore').textContent=`ניקוד: ${S.score} | הריגות: ${S.kills} | גל: ${S.wave} | זמן: ${Math.floor(S.elapsed/60)}:${String(Math.floor(S.elapsed%60)).padStart(2,'0')}`;
}
document.getElementById('bstart')?.addEventListener('click',startGame);
document.getElementById('breset')?.addEventListener('click',()=>{
  gameRunning=false;resetState();
  q('go').style.display='none';showUI();setCamera('cockpit');
  initWorld3D();
  gameRunning=true;lastT=performance.now();
  requestAnimationFrame(gameLoop);
});

// Boot
initStartAnim();
// Do an initial render so the 3D scene shows on start screen
renderer.render(scene,camera);