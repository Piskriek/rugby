import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { DIVE_FLIGHT_SECONDS, DIVE_MISS_RECOVERY } from '../src/game/engine/latch';
let seed=555; const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
Math.random=rnd as any;
const NO:any={up:false,down:false,left:false,right:false,a:false,b:false,x:false,y:false};
let dives=0, hits=0, misses=0, punished=0;
const headingDrift:number[]=[]; let steeredWhileAirborne=0;
for(let m=0;m<3;m++){
  const d=new Director(gateConfig(3));
  let f=0; const air=new Map<string,{f:number;vx:number;vz:number}>();
  const prevDive=new Map<string,number>();
  while(!d.over && f<40000){
    d.update(1/60,NO,new Set()); f++;
    for(const t of ['A','B'] as const) for(let k=1;k<=15;k++){
      const p:any=d.L(t,k); if(!p) continue; const key=`${t}:${k}`;
      const dv=p.diveT??0, was=prevDive.get(key)??0; prevDive.set(key,dv);
      if(dv>0 && was<=0){ dives++; air.set(key,{f,vx:p.vx,vz:p.vz}); }
      const a=air.get(key);
      if(a && dv>0){
        const sp=Math.hypot(p.vx,p.vz);
        if(sp<0.5) continue;          // atan2 of a near-zero vector is noise
        const h0=Math.atan2(a.vz,a.vx), h1=Math.atan2(p.vz,p.vx);
        let dd=Math.abs(h1-h0); if(dd>Math.PI) dd=2*Math.PI-dd;
        headingDrift.push(dd*180/Math.PI);
        if(dd>0.35) steeredWhileAirborne++;
      }
      if(a && dv<=0 && was>0){
        // a dive that ended because contact happened is a SUCCESS, whether it
        // ended as a latch or by the breakdown taking over
        if(p.latchingOnto || d.phase!=='OPEN_PLAY') hits++;
        else { misses++; if((p.recoverT??0)>0) punished++; }
        air.delete(key);
      }
    }
  }
}
const q=(x:number[],pp:number)=>{const s=[...x].sort((a,b)=>a-b);return s[Math.floor(s.length*pp)]??0;};
console.log('DIVE_FLIGHT_SECONDS',DIVE_FLIGHT_SECONDS,' DIVE_MISS_RECOVERY',DIVE_MISS_RECOVERY);
console.log('dives armed         :',dives);
console.log('  connected         :',hits,`(${(hits/Math.max(1,dives)*100).toFixed(0)}%)`);
console.log('  missed            :',misses,`(${(misses/Math.max(1,dives)*100).toFixed(0)}%)`);
console.log('  MISSES PUNISHED   :',punished,`of ${misses}`,`(${(punished/Math.max(1,misses)*100).toFixed(0)}%)`);
console.log('heading drift while airborne: median',q(headingDrift,.5).toFixed(2),'deg  p99',q(headingDrift,.99).toFixed(2),'deg');
console.log('frames steered >20deg mid-air:',steeredWhileAirborne,steeredWhileAirborne===0?' PASS (trajectory locked)':' FAIL');
