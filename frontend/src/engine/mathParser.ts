// Small, dependency-free expression parser/compiler for the equation plotter.
// Friendly to textbook notation: 2x, 3sin(x), x(x+1), sin^2(x), ax^2+bx+c, sinx, pi.

import type { AngleUnit } from './types';

export class ParseError extends Error {}
export type Env = Record<string, number>;
type Node = (e: Env) => number;

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const FUNC_NAMES = [
  'asin', 'acos', 'atan2', 'atan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'sqrt', 'cbrt', 'abs',
  'exp', 'ln', 'log10', 'log2', 'log', 'floor', 'ceil', 'round', 'sign', 'min', 'max', 'pow', 'mod',
];
const WORDS = [...FUNC_NAMES, 'theta', 'pi'].sort((a, b) => b.length - a.length);

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'fn'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const s = src.toLowerCase().replace(/θ/g, 'theta').replace(/π/g, 'pi').replace(/×|·/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/²/g, '^2').replace(/³/g, '^3');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    if (/[a-z]/.test(ch)) {
      const word = /^[a-z]+/.exec(s.slice(i))![0];
      let j = 0;
      while (j < word.length) {
        const known = WORDS.find((w) => word.startsWith(w, j));
        const name = known ?? word[j];
        j += name.length;
        if (name === 'theta') out.push({ t: 'id', v: 'theta' });
        else if (FUNC_NAMES.includes(name)) out.push({ t: 'fn', v: name });
        else out.push({ t: 'id', v: name });
      }
      i += word.length;
      // log2 / log10 / atan2 are written with digits
      const last = out[out.length - 1];
      if (last?.t === 'fn') {
        const rest = s.slice(i);
        if (last.v === 'log' && rest.startsWith('10')) { last.v = 'log10'; i += 2; }
        else if (last.v === 'log' && rest.startsWith('2')) { last.v = 'log2'; i += 1; }
        else if (last.v === 'atan' && rest.startsWith('2')) { last.v = 'atan2'; i += 1; }
      }
      continue;
    }
    if ('+-*/^(),'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new ParseError(`Unexpected "${ch}"`);
  }
  return out;
}

function makeFuncs(angle: AngleUnit) {
  const toR = angle === 'deg' ? (x: number) => (x * Math.PI) / 180 : (x: number) => x;
  const fromR = angle === 'deg' ? (x: number) => (x * 180) / Math.PI : (x: number) => x;
  const clean = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
  const f: Record<string, (...a: number[]) => number> = {
    sin: (x) => clean(Math.sin(toR(x))),
    cos: (x) => clean(Math.cos(toR(x))),
    tan: (x) => {
      const r = toR(x);
      // exact asymptotes (90°, 270°…) instead of 1.6e16
      return Math.abs(Math.cos(r)) < 1e-12 ? NaN : clean(Math.tan(r));
    },
    asin: (x) => fromR(Math.asin(x)),
    acos: (x) => fromR(Math.acos(x)),
    atan: (x) => fromR(Math.atan(x)),
    atan2: (y, x) => fromR(Math.atan2(y, x)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
    ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
    min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => ((a % b) + b) % b,
  };
  return f;
}

export interface Compiled {
  fn: Node;
  vars: string[];
}

export function compileExpr(src: string, angle: AngleUnit): Compiled {
  const toks = tokenize(src);
  if (!toks.length) throw new ParseError('Empty expression');
  const funcs = makeFuncs(angle);
  const vars = new Set<string>();
  let pos = 0;

  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new ParseError(`Expected "${v}"`);
    pos++;
  };
  const startsPrimary = () => {
    const k = peek();
    return !!k && (k.t === 'num' || k.t === 'id' || k.t === 'fn' || (k.t === 'op' && k.v === '('));
  };

  function expr(): Node {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { v: string }).v;
      pos++;
      const l = left;
      const r = term();
      left = op === '+' ? (e) => l(e) + r(e) : (e) => l(e) - r(e);
    }
    return left;
  }
  function term(): Node {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (peek() as { v: string }).v;
        pos++;
        const l = left;
        const r = unary();
        left = op === '*' ? (e) => l(e) * r(e) : (e) => l(e) / r(e);
      } else if (startsPrimary()) {
        const l = left;
        const r = unary(); // implicit multiplication
        left = (e) => l(e) * r(e);
      } else return left;
    }
  }
  function unary(): Node {
    if (isOp('-')) { pos++; const o = unary(); return (e) => -o(e); }
    if (isOp('+')) { pos++; return unary(); }
    return power();
  }
  function power(): Node {
    const base = primary();
    if (isOp('^')) {
      pos++;
      const ex = unary(); // right associative, allows 2^-3
      return (e) => Math.pow(base(e), ex(e));
    }
    return base;
  }
  function primary(): Node {
    const k = peek();
    if (!k) throw new ParseError('Unexpected end of expression');
    if (k.t === 'num') { pos++; const n = k.v; return () => n; }
    if (k.t === 'id') {
      pos++;
      if (k.v in CONSTS) { const c = CONSTS[k.v]; return () => c; }
      vars.add(k.v);
      const name = k.v;
      return (e) => e[name];
    }
    if (k.t === 'fn') {
      pos++;
      const f = funcs[k.v];
      // sin^2(x) means (sin x)^2
      let expo: Node | null = null;
      if (isOp('^')) { pos++; expo = unaryNoImplicit(); }
      let args: Node[];
      if (isOp('(')) {
        pos++;
        args = [expr()];
        while (isOp(',')) { pos++; args.push(expr()); }
        eat(')');
      } else {
        args = [power()]; // "sin x"
      }
      const call: Node = args.length === 1 ? (e) => f(args[0](e)) : (e) => f(...args.map((a) => a(e)));
      return expo ? (e) => Math.pow(call(e), expo!(e)) : call;
    }
    if (k.v === '(') {
      pos++;
      const inner = expr();
      eat(')');
      return inner;
    }
    throw new ParseError(`Unexpected "${k.v}"`);
  }
  function unaryNoImplicit(): Node {
    if (isOp('-')) { pos++; const o = unaryNoImplicit(); return (e) => -o(e); }
    const k = peek();
    if (k?.t === 'num') { pos++; const n = k.v; return () => n; }
    if (isOp('(')) { pos++; const i = expr(); eat(')'); return i; }
    throw new ParseError('Bad exponent');
  }

  const fn = expr();
  if (pos < toks.length) throw new ParseError(`Unexpected "${(toks[pos] as { v: string | number }).v}"`);
  return { fn, vars: [...vars] };
}

// ------------------------------------------------------------------ equations

export type ParsedEq =
  | { kind: 'cartesian'; f: Node; params: string[] } // y = f(x)
  | { kind: 'inverse'; f: Node; params: string[] } // x = g(y)
  | { kind: 'polar'; f: Node; params: string[] } // r = f(theta)
  | { kind: 'parametric'; fx: Node; fy: Node; params: string[] } // (x(t), y(t))
  | { kind: 'implicit'; F: Node; params: string[] } // lhs = rhs
  | { kind: 'ineq'; F: Node; op: '<' | '>' | '<=' | '>='; params: string[] };

/** Any letter that is not one of the equation's own variables becomes an adjustable parameter (a slider). */
const freeParams = (vars: string[], own: string[]) => [...new Set(vars)].filter((n) => !own.includes(n)).sort();

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

export function parseEquation(text: string, angle: AngleUnit): ParsedEq {
  const src = text.trim();
  if (!src) throw new ParseError('Type an equation, e.g. y = 2x + 1');

  // Parametric: (cos(t), sin(t))
  if (src.startsWith('(') && src.endsWith(')')) {
    const inner = src.slice(1, -1);
    const parts = splitTopLevel(inner, ',');
    if (parts.length === 2) {
      const cx = compileExpr(parts[0], angle);
      const cy = compileExpr(parts[1], angle);
      return { kind: 'parametric', fx: cx.fn, fy: cy.fn, params: freeParams([...cx.vars, ...cy.vars], ['t']) };
    }
  }

  const m = /^(.*?)(<=|>=|≤|≥|<|>|=)(.*)$/.exec(src);
  if (!m) {
    const c = compileExpr(src, angle);
    if (c.vars.includes('y')) throw new ParseError('Add "= …" (e.g. x^2 + y^2 = 25)');
    return { kind: 'cartesian', f: c.fn, params: freeParams(c.vars, ['x']) };
  }
  let lhs = m[1].trim().toLowerCase();
  let rhs = m[3].trim();
  const opRaw = m[2];
  if (!lhs || !rhs) throw new ParseError('Both sides of the equation are needed');

  if (opRaw !== '=') {
    const op = (opRaw === '≤' ? '<=' : opRaw === '≥' ? '>=' : opRaw) as '<' | '>' | '<=' | '>=';
    const L = compileExpr(lhs, angle);
    const R = compileExpr(rhs, angle);
    return { kind: 'ineq', op, F: (e) => L.fn(e) - R.fn(e), params: freeParams([...L.vars, ...R.vars], ['x', 'y']) };
  }

  if (rhs.toLowerCase() === 'y' || /^r(\(theta\))?$/i.test(rhs)) [lhs, rhs] = [rhs.toLowerCase(), lhs];

  const L = lhs.replace(/\s+/g, '');
  if (L === 'y' || L === 'f(x)' || L === 'y(x)') {
    const c = compileExpr(rhs, angle);
    if (!c.vars.includes('y')) return { kind: 'cartesian', f: c.fn, params: freeParams(c.vars, ['x']) };
  } else if (L === 'r' || L === 'r(theta)') {
    const c = compileExpr(rhs, angle);
    return { kind: 'polar', f: c.fn, params: freeParams(c.vars, ['theta']) };
  } else if (L === 'x') {
    const c = compileExpr(rhs, angle);
    if (!c.vars.includes('x')) return { kind: 'inverse', f: c.fn, params: freeParams(c.vars, ['y']) };
  }
  const a = compileExpr(lhs, angle);
  const b = compileExpr(rhs, angle);
  return { kind: 'implicit', F: (e) => a.fn(e) - b.fn(e), params: freeParams([...a.vars, ...b.vars], ['x', 'y']) };
}
