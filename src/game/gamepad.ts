/**
 * Gamepad support — the AAA control layer.
 *
 * A single standard layout, tuned for the two-stick sports-pad conventions:
 *
 *   LEFT STICK ........ move / run
 *   RIGHT STICK ....... cut (left / right)
 *   A / CROSS ......... action · sprint (hold)
 *   B / CIRCLE ........ tackle dive
 *   X / SQUARE ........ pass left
 *   Y / TRIANGLE ...... pass right
 *   LB / L1 ........... fend
 *   RB / R1 ........... kick
 *   LT / L2 ........... take contact
 *   RT / R2 ........... sprint burst (hold)
 *   DPAD .............. the same as the stick for the set-piece waggles
 *   L3 (left stick) ... step
 *   R3 (right stick) .. switch player
 *   SELECT / BACK ..... live statistics
 *   START ............. pause
 *
 * This module only *reports* the controller. The React view decides how the
 * verbs are consumed, so the pad can never fight the keyboard.
 */
import { Input, NO_INPUT } from './director';

export interface GamepadFrame {
  connected: boolean;
  id: string;
  name: string;
  /** Held verbs — ORed into the keyboard input each frame. */
  input: Input;
  /** Pressed edge verbs — consumed exactly like a keydown. */
  pressed: string[];
  /** Released edge verbs — needed by the hold-to-kick system. */
  released: string[];
  /** Snapshot used by the caller to feed back into pollGamepad next frame. */
  buttons: boolean[];
  axes: { up: boolean; down: boolean; left: boolean; right: boolean; cutL: boolean; cutR: boolean };
}

export interface PrevGp {
  buttons: boolean[];
  axes: { up: boolean; down: boolean; left: boolean; right: boolean; cutL: boolean; cutR: boolean };
}

const AXIS_EDGE = 0.42;

const emptyPrev = (): PrevGp => ({
  buttons: [],
  axes: { up: false, down: false, left: false, right: false, cutL: false, cutR: false },
});

const emptyFrame = (): GamepadFrame => ({
  connected: false,
  id: '',
  name: '',
  input: { ...NO_INPUT },
  pressed: [],
  released: [],
  buttons: [],
  axes: emptyPrev().axes,
});

const neg = (pad: Gamepad, axis: number) => (axis < 4 ? pad.axes[axis] ?? 0 : 0) < -AXIS_EDGE;
const pos = (pad: Gamepad, axis: number) => (axis < 4 ? pad.axes[axis] ?? 0 : 0) > AXIS_EDGE;

/** Which verb name a button maps to on its rising edge. */
const BUTTON_EDGE: Record<number, string> = {
  0: 'action',
  1: 'tackleDive',
  2: 'passL',
  3: 'passR',
  4: 'fend',
  5: 'kick',
  6: 'contact',
  8: 'stats',
  9: 'pause',
  10: 'step',
  11: 'switchPlayer',
};

const BUTTON_HELD: Record<number, keyof Input> = {
  0: 'action',
  7: 'sprint',
};

function edge(pressed: string[], released: string[], now: boolean, was: boolean, verb: string) {
  if (now && !was) pressed.push(verb);
  if (!now && was) released.push(verb);
}

export function pollGamepad(prev: PrevGp | null): GamepadFrame {
  const frame = emptyFrame();
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return frame;

  let pad: Gamepad | null = null;
  try {
    for (const p of navigator.getGamepads()) {
      if (p && p.connected && (p.buttons.length || p.axes.length)) { pad = p; break; }
    }
  } catch {
    return frame;
  }
  if (!pad) return frame;

  frame.connected = true;
  frame.id = pad.id;
  frame.name = (pad as unknown as { map?: string }).map || pad.id || 'GAMEPAD';

  const held = { ...frame.input };
  const pressed: string[] = [];
  const released: string[] = [];
  const old = prev ?? emptyPrev();

  // Left stick / dpad movement, with rising edges for waggles.
  const axisUp = neg(pad, 1) || Boolean(pad.buttons[12]?.pressed);
  const axisDown = pos(pad, 1) || Boolean(pad.buttons[13]?.pressed);
  const axisLeft = neg(pad, 0) || Boolean(pad.buttons[14]?.pressed);
  const axisRight = pos(pad, 0) || Boolean(pad.buttons[15]?.pressed);
  const cutL = neg(pad, 2);
  const cutR = pos(pad, 2);
  held.up = axisUp;
  held.down = axisDown;
  held.left = axisLeft;
  held.right = axisRight;
  held.cutL = cutL;
  held.cutR = cutR;
  edge(pressed, released, axisUp, old.axes.up, 'up');
  edge(pressed, released, axisDown, old.axes.down, 'down');
  edge(pressed, released, axisLeft, old.axes.left, 'left');
  edge(pressed, released, axisRight, old.axes.right, 'right');
  edge(pressed, released, cutL, old.axes.cutL, 'cutL');
  edge(pressed, released, cutR, old.axes.cutR, 'cutR');

  // A button is sprint/run while held and action on the edge.
  const a = Boolean(pad.buttons[0]?.pressed);
  if (a) { held.sprint = true; held.run = true; }

  const rt = Boolean(pad.buttons[7]?.pressed);
  if (rt) { held.sprint = true; held.run = true; }

  // Buttons 0–11 edges + held verbs.
  for (let i = 0; i < 16; i++) {
    const now = Boolean(pad.buttons[i]?.pressed);
    const was = Boolean(old.buttons[i]);
    const verb = BUTTON_EDGE[i];
    if (verb) edge(pressed, released, now, was, verb);
    const heldKey = BUTTON_HELD[i];
    if (heldKey && now) held[heldKey] = true;
  }

  frame.input = held;
  frame.pressed = pressed;
  frame.released = released;
  frame.buttons = Array.from({ length: 16 }, (_, i) => Boolean(pad.buttons[i]?.pressed));
  frame.axes = { up: axisUp, down: axisDown, left: axisLeft, right: axisRight, cutL, cutR };
  return frame;
}

export { emptyPrev };
