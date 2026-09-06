// dev: print channel curves for one bank entry
import { findFall, samplePose } from '../src/physics/fallBank';
const e = findFall({ kind: 'FALL', speed: 6, hitH: 0.6, massR: 1, dir: 'F' });
console.log('entry', e.meta);
for (let i = 0; i < 66; i++) {
  const s = samplePose(e, i / 30, false);
  const f = (x: number) => x.toFixed(2);
  console.log(
    `t${(i / 30).toFixed(2)} α${f(s[0])} τ${f(s[1])} bend${f(s[2])} hdX${f(s[3])} hdY${f(s[4])}` +
    ` | armF${f(s[5])} abR${f(s[6])} elb${f(s[7])} | legF${f(s[11])} abLg${f(s[12])} knee${f(s[13])}`);
}
