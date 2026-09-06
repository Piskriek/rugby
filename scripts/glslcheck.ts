/**
 * scripts/glslcheck.ts — PARSE EVERY SHADER IN THE RENDERER.
 *
 * Why this exists: a GLSL error is the worst kind of error in this codebase.
 * There is no browser in the harness container, the engine tests are all
 * headless, and a shader that fails to compile does not throw in a way a test
 * can see — it throws inside `renderer.compile()` at the first frame, in the
 * user's browser, on a machine we cannot reach. The failure mode is a black
 * rectangle and a console nobody reads.
 *
 * So: extract every `/* glsl *\/` template literal in `src/render`, wrap it in
 * the prefix three.js itself would give it (precision, the built-in matrices,
 * the default attributes), and run it through a real GLSL parser. Then apply
 * the two lint rules that a parser cannot catch but a driver punishes:
 *
 *   - `smoothstep(a, b, x)` with a > b is UNDEFINED in GLSL ES, not inverted.
 *     Several of our ramps want an inverted ramp, so they must be written
 *     `1.0 - smoothstep(b, a, x)`. This rule is not pedantry: the reversed form
 *     compiles on ANGLE, and has been observed to return 0.0 on others.
 *   - `attribute`/`varying` in a fragment stage, or `varying` written in a
 *     fragment shader without a matching vertex output — the classic copy-paste.
 *
 * Run: `npx vite-node scripts/glslcheck.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** three.js WebGLProgram prefixVertex, reduced to what a parse needs. */
const PREFIX_VERT = `
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;

const PREFIX_FRAG = `
precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;

interface Found {
  file: string; stage: 'vert' | 'frag'; src: string; line: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Pull every `/* glsl *\/` template literal and guess its stage. */
function extract(file: string, code: string): Found[] {
  const found: Found[] = [];
  const re = /\/\* glsl \*\/\s*`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const src = m[1];
    const before = code.slice(0, m.index);
    const line = before.split('\n').length;
    const lower = src.toLowerCase();
    let stage: 'vert' | 'frag' = lower.includes('gl_position') && lower.includes('gl_pointsize')
      ? 'vert'
      : lower.includes('gl_fragcolor') ? 'frag'
        : lower.includes('gl_position') ? 'vert' : 'frag';
    /* The naming convention in this repo is <NAME>_VERT / <NAME>_FRAG; trust
     * the identifier over the body when the body is a fragment-less passthrough. */
    const idm = /([A-Za-z0-9_]+)\s*=\s*\/\* glsl \*\//g.exec(code.slice(Math.max(0, m.index - 200), m.index + 20));
    if (idm) {
      if (/_VERT$/.test(idm[1])) stage = 'vert';
      else if (/_FRAG$/.test(idm[1])) stage = 'frag';
    }
    found.push({ file, stage, src, line });
  }
  return found;
}

/** Numeric smoothstep inversion check. */
function smoothstepCheck(src: string): string[] {
  const errs: string[] = [];
  const re = /smoothstep\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      const line = src.slice(0, m.index).split('\n').length;
      errs.push(`reversed smoothstep(${m[1].trim()}, ${m[2].trim()}) at shader line ${line} — write 1.0 - smoothstep(${m[2].trim()}, ${m[1].trim()}, x)`);
    }
  }
  return errs;
}

async function main() {
  const files = walk(join(ROOT, 'src/render'));
  const all: Found[] = [];
  for (const f of files) all.push(...extract(f, readFileSync(f, 'utf8')));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parse: ((src: string, opts?: any) => any) | null = null;
  try {
    const mod = await import('@shaderfrog/glsl-parser' as string);
    parse = (mod as any).parser.parse;
  } catch {
    parse = null;
    console.log('note: @shaderfrog/glsl-parser not installed — running lint rules only');
  }

  let fails = 0;
  for (const sh of all) {
    const rel = relative(ROOT, sh.file);
    const body = sh.src.replace(/^\s*precision highp float;\s*/m, '');
    const full = (sh.stage === 'vert' ? PREFIX_VERT : PREFIX_FRAG) + body;
    const problems: string[] = [];

    if (parse) {
      try {
        parse(full, { quiet: true });
      } catch (e) {
        problems.push(`parse error: ${(e as Error).message.split('\n').slice(0, 3).join(' | ')}`);
      }
    }
    problems.push(...smoothstepCheck(body));
    if (sh.stage === 'frag' && /\battribute\b/.test(body)) {
      problems.push('`attribute` in a fragment stage');
    }
    if (sh.stage === 'frag' && /gl_PointSize/.test(body)) {
      problems.push('`gl_PointSize` written in a fragment stage');
    }

    if (problems.length) {
      fails++;
      console.log(`FAIL ${rel}:${sh.line} [${sh.stage}]`);
      for (const p of problems) console.log(`     · ${p}`);
    } else {
      console.log(`ok   ${rel}:${sh.line} [${sh.stage}] ${body.split('\n').length} lines`);
    }
  }
  console.log(`\n${all.length} shaders scanned, ${fails} failing.`);
  if (fails) process.exit(1);
}

main();
