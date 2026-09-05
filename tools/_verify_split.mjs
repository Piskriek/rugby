import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
function img(){return{width:4,height:4,naturalWidth:4,naturalHeight:4,style:{},set src(v){this._s=v;queueMicrotask(()=>this.onload&&this.onload());},get src(){return this._s;},addEventListener(e,f){if(e==='load')this.onload=f;},removeEventListener(){},getContext:()=>null,data:new Uint8Array(64)};}
globalThis.self=globalThis;
globalThis.document={createElementNS:()=>img(),createElement:(t)=>t==='canvas'?{width:4,height:4,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array(64)})}),style:{}}:img()};
globalThis.URL={createObjectURL:()=>'x',revokeObjectURL(){}};
const buf=readFileSync(process.argv[2]??'public/assets/models/rugby_player.glb');
const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
const gltf=await new Promise((res,rej)=>new GLTFLoader().parse(ab,'',res,rej));
const root=gltf.scene;
root.traverse(o=>{ if(o.isSkinnedMesh&&o.skeleton) o.skeleton.pose(); });
root.updateMatrixWorld(true);

const classify=(n)=>{
  if(/_(thigh|calf|foot|ball)_[lr]$/.test(n)) return n.endsWith('_l')?'L':'R';
  if(/^ball_leaf_[lr]$/.test(n)) return n.endsWith('_l')?'L':'R';
  return null;
};
let body=null;
root.traverse(o=>{ if(o.isSkinnedMesh&&o.material?.name==='MI_Superhero_Male') body=o; });
const g=body.geometry;
const pos=g.attributes.position, jA=g.attributes.skinIndex??g.attributes.joints0, wA=g.attributes.skinWeight??g.attributes.weights0;
const skel=body.skeleton;
const legSide={};
skel.bones.forEach((b,i)=>legSide[i]=classify(b.name));

// ---- replicate sanitizeLegWeights ----
let pinned=0, cleaned=0;
for(let vi=0;vi<jA.count;vi++){
  let dom=0,domW=-1;
  for(let k=0;k<4;k++){const w=wA.getComponent(vi,k);if(w>domW){domW=w;dom=jA.getComponent(vi,k);}}
  const side=legSide[dom]; if(!side) continue;
  let sum=0; const kept=[];
  for(let k=0;k<4;k++){const bi=jA.getComponent(vi,k);let w=wA.getComponent(vi,k);if(legSide[bi]&&legSide[bi]!==side){w=0;}kept.push(w);sum+=w;}
  if(sum>1e-4){ for(let k=0;k<4;k++){const bi=jA.getComponent(vi,k);if(!(legSide[bi]&&legSide[bi]!==side))wA.setComponent(vi,k,kept[k]/sum);} }
  else { for(let k=0;k<4;k++){jA.setComponent(vi,k,0);wA.setComponent(vi,k,0);}jA.setComponent(vi,0,dom);wA.setComponent(vi,0,1);pinned++; }
}
jA.needsUpdate=wA.needsUpdate=true;

// ---- verify weights ----
let badSum=0, crossLeg=0;
for(let vi=0;vi<jA.count;vi++){
  let s=0,dom=0,domW=-1;
  for(let k=0;k<4;k++){s+=wA.getComponent(vi,k);const w=wA.getComponent(vi,k);if(w>domW){domW=w;dom=jA.getComponent(vi,k);}}
  if(Math.abs(s-1)>0.02) badSum++;
  const side=legSide[dom];
  if(side){ for(let k=0;k<4;k++){const bi=jA.getComponent(vi,k);if(legSide[bi]&&legSide[bi]!==side&&wA.getComponent(vi,k)>0.001) crossLeg++; } }
}
console.log('weight check: badSum='+badSum+'  crossLeg(influences)='+crossLeg+'  degeneratePinned='+pinned);

// ---- triangle majority bucketing (same as manager) ----
function boneRegion(n,restY){ if(/^(foot_|ball_[lr]|toe)/.test(n)||/^ball_leaf/.test(n))return restY<0.20?'boots':'socks'; if(/^calf_/.test(n))return restY<0.55?'socks':'skin'; if(/^thigh_/.test(n))return restY>0.70?'shorts':'skin'; if(/^(root|pelvis|spine|neck)/.test(n))return 'jersey'; if(/^(Head|index_|middle_|ring_|pinky_|thumb_)/.test(n))return 'skin'; if(/^(clavicle|upperarm|lowerarm|hand_)/.test(n))return /^clavicle_/.test(n)?'jersey':'skin'; return 'jersey'; }
const restY=new Map(); const tmp=new THREE.Vector3();
root.traverse(o=>{ if(o.isBone){o.getWorldPosition(tmp);restY.set(o.name,tmp.y);} });
const vtxSlot=new Array(pos.count);
for(let vi=0;vi<pos.count;vi++){let best=0,bw=-1;for(let k=0;k<4;k++){const w=wA.getComponent(vi,k);if(w>bw){bw=w;best=jA.getComponent(vi,k);}}const bn=skel.bones[best]?.name??'';vtxSlot[vi]=boneRegion(bn,restY.get(bn)??1);}
const index=g.index; const triCount=index?index.count/3:pos.count/3;
const srcIdx=(n)=>index?index.getX(n):n;
const counts={}; let assigned=0;
for(let t=0;t<triCount;t++){const a=srcIdx(t*3),b=srcIdx(t*3+1),c=srcIdx(t*3+2);const sa=vtxSlot[a],sb=vtxSlot[b],sc=vtxSlot[c];let slot=sa;if(sb===sc)slot=sb;else if(sa===sb||sa===sc)slot=sa;counts[slot]=(counts[slot]||0)+1;assigned++;}
console.log('triangle coverage: total='+triCount+' assigned='+assigned+(assigned===triCount?'  OK (watertight)':'  MISMATCH'));
console.log('per-region tri counts:',JSON.stringify(counts));
process.exit(0);
