import { Director } from '../game/director';
import { Btn } from './kit';

const MODES = ['AUTO', 'PASS', 'KICK', 'CONTACT', 'TACKLE', 'SPRINT'];
const NAMES = ['AUTO (MOST LOGICAL)', 'PASS', 'KICK', 'TAKE CONTACT', 'TACKLE', 'SPRINT'];

/** Lets the player choose what SPACE does. AUTO picks the most logical action. */
export function SpaceRemap({ d, force }: { d: Director; force: (f: (n: number) => number) => void }) {
  const cur = d.options.spaceAction ?? 0;
  return (
    <div className="mt-3 border-t border-[#26314a] pt-2">
      <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">
        WHAT SPACE DOES — {NAMES[cur]}
      </div>
      <div className="text-[9px] leading-snug text-[#7f8ea6]">
        AUTO reads the situation: offload under pressure, pass when clear, sprint into a gap, tackle when
        defending. Pick something else if it suits the way you play.
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {MODES.map((m, i) => (
          <Btn key={m} small active={cur === i} onClick={() => { d.options.spaceAction = i; force((n) => n + 1); }}>
            {m}
          </Btn>
        ))}
      </div>
      <div className="mt-1 text-[9px] text-[#cfd8e6]">
        RIGHT NOW SPACE WOULD: <span className="font-black text-[#6ee7a0]">{d.contextVerb.label}</span>
      </div>
    </div>
  );
}
