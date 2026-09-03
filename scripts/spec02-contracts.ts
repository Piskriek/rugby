/**
 * SPEC_02 PHASE A/B — isolated-contract checks.
 *
 * Usage: npx vite-node scripts/spec02-contracts.ts
 *
 * This deliberately imports only the pure helpers. It neither creates a
 * Director nor runs a game loop, so it proves the review candidate without
 * changing live AI state.
 */

import { deepEqual, equal, ok } from 'node:assert/strict';
import {
  evaluateForwardAttackPriority,
  FORWARD_ATTACK_PRIORITY_MATRIX,
  hasGuaranteedForwardGain,
  isLegalUncoveredWingOverride,
} from '../src/game/intelligence';
import { forwardAttackDepth } from '../src/game/shapes';

let checks = 0;

function check(name: string, condition: boolean): void {
  ok(condition, name);
  checks++;
}

function close(actual: number, expected: number, name: string): void {
  check(name, Math.abs(actual - expected) < 0.000001);
}

// The matrix is explicit and complete: F=false/W=false through F=true/W=true.
deepEqual(FORWARD_ATTACK_PRIORITY_MATRIX, [
  { forwardGainGuaranteed: false, wingOverrideEligible: false, priority: 'NONE' },
  { forwardGainGuaranteed: false, wingOverrideEligible: true, priority: 'UNCOVERED_WING' },
  { forwardGainGuaranteed: true, wingOverrideEligible: false, priority: 'FORWARD_GAIN' },
  { forwardGainGuaranteed: true, wingOverrideEligible: true, priority: 'UNCOVERED_WING' },
]);
checks++;

check('three metres establishes a guaranteed forward gain', hasGuaranteedForwardGain(3));
check('less than three metres is not guaranteed', !hasGuaranteedForwardGain(2.99));

equal(evaluateForwardAttackPriority({ forwardGainMetres: 4, wing: null }).priority, 'FORWARD_GAIN');
checks++;

equal(evaluateForwardAttackPriority({
  forwardGainMetres: 2,
  wing: { shirt: 11, uncovered: true, lateralSeparationMetres: 12, forwardGainMetres: 1 },
}).priority, 'UNCOVERED_WING');
checks++;

const legalOverride = {
  forwardGainMetres: 4,
  wing: { shirt: 14, uncovered: true, lateralSeparationMetres: 12, forwardGainMetres: 3 },
} as const;
check('an equivalent uncovered wing may override a guaranteed gain', isLegalUncoveredWingOverride(legalOverride));
equal(evaluateForwardAttackPriority(legalOverride).priority, 'UNCOVERED_WING');
checks++;

const expensiveWing = {
  forwardGainMetres: 4,
  wing: { shirt: 14, uncovered: true, lateralSeparationMetres: 12, forwardGainMetres: 2.99 },
} as const;
check('a wing may not concede more than one metre of a guaranteed gain', !isLegalUncoveredWingOverride(expensiveWing));
equal(evaluateForwardAttackPriority(expensiveWing).priority, 'FORWARD_GAIN');
checks++;

check('a close-in wing is not a wide override', !isLegalUncoveredWingOverride({
  forwardGainMetres: 4,
  wing: { shirt: 11, uncovered: true, lateralSeparationMetres: 11.99, forwardGainMetres: 4 },
}));
check('a covered wing is not a wide override', !isLegalUncoveredWingOverride({
  forwardGainMetres: 4,
  wing: { shirt: 11, uncovered: false, lateralSeparationMetres: 14, forwardGainMetres: 4 },
}));

const immutablePriorityInput = Object.freeze({
  forwardGainMetres: 4,
  wing: Object.freeze({ shirt: 11, uncovered: true, lateralSeparationMetres: 14, forwardGainMetres: 3.5 }),
});
const priorityBefore = JSON.stringify(immutablePriorityInput);
evaluateForwardAttackPriority(immutablePriorityInput);
equal(JSON.stringify(immutablePriorityInput), priorityBefore);
checks++;

const setup = {
  anchor: { x: 4, z: 10 },
  attackDirection: 1 as const,
  openside: -1 as const,
  lateralOffsetMetres: 12,
  nominalSupportDepthMetres: 6,
  shapeDepthBias: 1,
  tempo: 0.5,
  distanceToTryLineMetres: 50,
  role: 'POD' as const,
};
const setupBefore = JSON.stringify(setup);
const forwardPlan = forwardAttackDepth(setup);
close(forwardPlan.setup.x, -8, 'openside mirror applies to the lane');
close(forwardPlan.setup.z, 4.3, 'support remains behind a +z attack');
close(forwardPlan.arrival.z, 10, 'runner arrives exactly on the gain line');
close(forwardPlan.carryTarget.z, 12.75, 'pod carry target is forward of the gain line');
check('the normal-field plan is not red-zone capped', !forwardPlan.redZoneCapped);
equal(JSON.stringify(setup), setupBefore);
checks++;

const mirroredPlan = forwardAttackDepth({ ...setup, attackDirection: -1 });
close(mirroredPlan.setup.z, 15.7, 'support remains behind a -z attack');
close(mirroredPlan.carryTarget.z, 7.25, 'carry target mirrors with attack direction');

const redZonePlan = forwardAttackDepth({
  anchor: { x: 0, z: 48 },
  attackDirection: 1,
  openside: 1,
  lateralOffsetMetres: 8,
  nominalSupportDepthMetres: 8,
  shapeDepthBias: 1,
  tempo: 0,
  distanceToTryLineMetres: 2,
  role: 'POD',
});
close(redZonePlan.supportDepthMetres, 0.66, 'red-zone cap keeps the support close enough to threaten');
close(redZonePlan.carryTarget.z, 49.5, 'carry target remains half a metre before the try line');
check('red-zone cap is surfaced for a future measurement gate', redZonePlan.redZoneCapped);

console.log(`SPEC_02 isolated contracts: ${checks}/${checks} checks passed`);
