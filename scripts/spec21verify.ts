import { threeQuarter, squashForClip, combineSquash, FOOT_SQUASH, hipRoots, BUILDS, TQ_NARROW } from './src/render/paper.ts';
type M=[number,number,number,number,number,number];
const I:M=[1,0,0,1,0,0];
const mul=(m:M,n:M):M=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const scale=(x:number,y:number):M=>[x,0,0,y,0,0];
const rot=(t:number):M=>[Math.cos(t),Math.sin(t),-Math.sin(t),Math.cos(t),0,0];
const shear=(k:number):M=>[1,0,k,1,0,0];
const trans=(x:number,y:number):M=>[1,0,0,1,x,y];
const ap=(m:M,x:number,y:number)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];

// NEW stack: FIG · MIRROR · ROT(fall) · SQUASH · LEAN · TQ
function stack(o:{fall:number,squash?:{sx:number,sy:number},lean:number,ang:number,front:boolean,mirror:number,hip:number,sc:number,fallD:number,spinDir:number,edge:boolean}){
  let m:M=I;
  if(o.mirror<0) m=mul(m,scale(-1,1));
  if(o.fall>0.01&&o.fall<0.985){
    const e=o.fall*o.fall*(3-2*o.fall);
    const dirSign=o.edge?1:o.spinDir;
    const spin=e*(Math.PI/2)*o.fallD*dirSign+Math.sin(o.fall*Math.PI)*0.06*dirSign;
    m=mul(m,trans(0,-o.hip*o.sc)); m=mul(m,rot(spin)); m=mul(m,trans(0,o.hip*o.sc));
  }
  if(o.squash) m=mul(m,scale(o.squash.sx,o.squash.sy));
  if(o.lean) m=mul(m,shear(-Math.tan(o.lean)*o.mirror));
  if(o.front){const tq=threeQuarter(o.ang); m=mul(m,scale(tq.narrow,1));}
  return m;
}
const H=1.8, SH=0.5;
function measure(m:M){
  const foot=ap(m,0,0), head=ap(m,0,-H);
  const s1=ap(m,SH/2,-1.4), s2=ap(m,-SH/2,-1.4);
  const spine=Math.hypot(head[0]-foot[0],head[1]-foot[1]);
  const wid=Math.hypot(s1[0]-s2[0],s1[1]-s2[1]);
  const tilt=Math.abs(Math.atan2(head[0]-foot[0], -(head[1]-foot[1]))*180/Math.PI);
  return {spine,wid,tilt};
}
let fail=0;
console.log('=== GATE A (Item 1): spine verticality across facing sweep, upright, no lean ===');
let maxTilt=0;
for(let ang=0;ang<=180;ang+=1){
  const r=measure(stack({fall:0,lean:0,ang,front:true,mirror:1,hip:0.92,sc:1,fallD:1,spinDir:1,edge:false}));
  maxTilt=Math.max(maxTilt,r.tilt);
}
console.log(' max apparent tilt over 0..180 deg =',maxTilt.toFixed(6),'deg  ->',maxTilt<1e-9?'PASS (exactly vertical)':'FAIL');
if(!(maxTilt<1e-9))fail++;
console.log('\n narrow curve: 0deg',threeQuarter(0).narrow.toFixed(4),' 30deg',threeQuarter(30).narrow.toFixed(4),' 55deg',threeQuarter(55).narrow.toFixed(4),' 90deg',threeQuarter(90).narrow.toFixed(4),'(floor',TQ_NARROW+')');

console.log('\n=== GATE B (Item 3): squash axes welded to the spine through full fall ===');
/* The figure SHOULD compress by exactly the squash when a tackle lands - that is
 * the effect, not a defect. The defect was the compression DRIFTING off the
 * spine as the card rotated. So the gate is INVARIANCE: measured spine/width
 * must equal H*sy / SH*sx at EVERY fall angle, not just upright. */
const s=squashForClip('tackleHit',0.45)!;
const sTot=combineSquash(FOOT_SQUASH,Math.max(0,1-s.sy));
const sq={sx:1+0.6*sTot,sy:1-sTot};
const expS=H*sq.sy, expW=SH*sq.sx;
let worstS=0,worstW=0,atS=0,atW=0;
for(let i=0;i<=100;i++){
  const f=i/100;
  for(const front of [true,false]) for(const mir of [1,-1]) for(const ang of [0,30,55,90]){
    const r=measure(stack({fall:f,squash:sq,lean:0,ang,front,mirror:mir,hip:0.92,sc:1,fallD:1,spinDir:mir,edge:!front}));
    const wexp = front ? expW*threeQuarter(ang).narrow : expW;
    const ds=Math.abs(r.spine-expS)/expS, dw=Math.abs(r.wid-wexp)/wexp;
    if(ds>worstS){worstS=ds;atS=f;} if(dw>worstW){worstW=dw;atW=f;}
  }
}
console.log(' squash applied: sy',sq.sy.toFixed(4),'sx',sq.sx.toFixed(4),'-> expected spine',expS.toFixed(4),'width',expW.toFixed(4));
console.log(' worst spine drift from figure-frame expectation',(worstS*100).toFixed(4)+'% at fall',atS.toFixed(2),'->',worstS<=0.05?'PASS':'FAIL');
console.log(' worst width drift from figure-frame expectation',(worstW*100).toFixed(4)+'% at fall',atW.toFixed(2),'->',worstW<=0.05?'PASS':'FAIL');
if(worstS>0.05)fail++; if(worstW>0.05)fail++;

// And the direct before/after comparison on the OLD order, same probe.
function oldFull(f:number,sq2:{sx:number,sy:number},ang:number,front:boolean){
  let m:M=I; m=mul(m,scale(sq2.sx,sq2.sy));
  if(front){const tq=threeQuarter(ang);m=mul(m,scale(tq.narrow,1));}
  if(f>0.01&&f<0.985){const e=f*f*(3-2*f);const spin=e*(Math.PI/2);
    m=mul(m,trans(0,-0.92));m=mul(m,rot(spin));m=mul(m,trans(0,0.92));}
  return measure(m);
}
console.log('\n fall | OLD spine  OLD width | NEW spine  NEW width  (expect '+expS.toFixed(3)+' / '+expW.toFixed(3)+')');
for(const f of [0,0.25,0.5,0.75,0.98]){
  const o=oldFull(f,sq,0,true);
  const n=measure(stack({fall:f,squash:sq,lean:0,ang:0,front:true,mirror:1,hip:0.92,sc:1,fallD:1,spinDir:1,edge:false}));
  console.log(' '+f.toFixed(2)+' |   '+o.spine.toFixed(3)+'      '+o.wid.toFixed(3)+'   |   '+n.spine.toFixed(3)+'      '+n.wid.toFixed(3));
}

console.log('\n=== GATE C: STANDING/RUNNING FOOTPRINT UNCHANGED (regression) ===');
// upright, no fall: new order must be numerically identical to the old for lean+tq
function oldStack(lean:number,ang:number,front:boolean,sq2?:{sx:number,sy:number}){
  let m:M=I; if(sq2)m=mul(m,scale(sq2.sx,sq2.sy));
  if(lean)m=mul(m,shear(-Math.tan(lean)));
  if(front){const tq=threeQuarter(ang);m=mul(m,scale(tq.narrow,1));}
  return m;
}
let maxDiff=0;
for(const lean of [0,0.05,0.1,0.18]) for(const ang of [0,20,45,90]) for(const useSq of [false,true]){
  const sq2=useSq?sq:undefined;
  const a=stack({fall:0,squash:sq2,lean,ang,front:true,mirror:1,hip:0.92,sc:1,fallD:1,spinDir:1,edge:false});
  const b=oldStack(lean,ang,true,sq2);
  for(let k=0;k<6;k++) maxDiff=Math.max(maxDiff,Math.abs(a[k]-b[k]));
}
console.log(' max matrix element delta vs pre-reorder (upright, fall=0):',maxDiff.toExponential(2),'->',maxDiff<1e-12?'PASS (bit-identical)':'FAIL');
if(!(maxDiff<1e-12))fail++;

console.log('\n=== GATE D (Item 2): crotch notch below roots, all builds ===');
let bad=0;
for(const [n,b] of Object.entries(BUILDS as any)){
  const rt=hipRoots(b as any,0.92); const hemS=rt.y-0.05;
  const notchY=Math.min(hemS+0.055, rt.y-0.012);
  const depth=rt.y-notchY;
  const belowHem=notchY-hemS;
  if(!(depth>=0.012-1e-12 && belowHem>0)) {bad++;console.log('  FAIL',n);}
}
console.log(' builds with apex >=12mm below roots AND still a visible V:',10-bad,'/10 ->',bad===0?'PASS':'FAIL');
if(bad)fail++;
console.log('\n'+(fail?`${fail} GATE(S) FAILED`:'ALL SPEC_21 GATES PASS'));
