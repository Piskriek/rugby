import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
function img(){return{width:4,height:4,naturalWidth:4,naturalHeight:4,style:{},set src(v){this._s=v;queueMicrotask(()=>this.onload&&this.onload());},get src(){return this._s;},addEventListener(e,f){if(e==='load')this.onload=f;},removeEventListener(){},getContext:()=>null,data:new Uint8Array(64)};}
globalThis.self=globalThis;
globalThis.document={createElementNS:()=>img(),createElement:(t)=>t==='canvas'?{width:4,height:4,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array(64)})}),style:{}}:img()};
globalThis.URL={createObjectURL:()=>'x',revokeObjectURL(){}};
const buf=readFileSync(process.argv[2]);
const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
const gltf=await new Promise((res,rej)=>new GLTFLoader().parse(ab,'',res,rej));
const root=gltf.scene; root.updateMatrixWorld(true);
function cent(name){let c=new THREE.Vector3(),n=0,mat='';root.traverse(o=>{if(o.isSkinnedMesh&&o.name===name){mat=o.material.name;const pa=o.geometry.attributes.position;for(let i=0;i<pa.count;i++){c.add(new THREE.Vector3().fromBufferAttribute(pa,i).applyMatrix4(o.matrixWorld));n++;}}});if(n)c.divideScalar(n);return n?{c,mat}:null;}
for(const m of ['Face','Face.001']){const r=cent(m);if(r)console.log(m.padEnd(10),'mat='+r.mat.padEnd(12),'centroid z=',r.c.z.toFixed(4),' x=',r.c.x.toFixed(3),' y=',r.c.y.toFixed(3));}
// nose/front: find the max-z vertex of the eyes material specifically
let fz=-9,bz=9;
root.traverse(o=>{ if(o.isSkinnedMesh && o.material?.name==='MI_Eyes'){ const pa=o.geometry.attributes.position; for(let i=0;i<pa.count;i++){ const w=new THREE.Vector3().fromBufferAttribute(pa,i).applyMatrix4(o.matrixWorld); fz=Math.max(fz,w.z); bz=Math.min(bz,w.z);} }});
console.log('MI_Eyes z extent:', bz.toFixed(4),'..',fz.toFixed(4),'=> front is', fz>0?'+Z':'-Z');
process.exit(0);
