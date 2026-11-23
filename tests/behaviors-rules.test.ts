/**
 * 선생님이 더한 새 움직임(platform/behaviors/*.ts)이 약속을 지키는지 본다. 병합할 때 운영자가 한 줄씩 다시 읽는 것이 진짜 관문이고,
 * 이 시험은 그 앞에서 흔한 실수와 뻔한 우회를 걸러 내는 그물이다(정규식이 아니라 TypeScript 문법 나무로 본다).
 * 약속: 바깥과 주고받지 않는다 · 시간과 난수를 쓰지 않는다(방장이 바뀌어도 같은 결과) · 판의 손잡이(behavior.ts)만 쓴다 · 끝나지 않는 반복을 두지 않는다.
 * 이 파일과 platform/behavior.ts 는 선생님 요청(PR)이 고칠 수 없다(.github/workflows/pack-triage.yml 의 막는 목록).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BEHAVIORS } from '../platform/behavior';

const dir = fileURLToPath(new URL('../platform/behaviors/', import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

/** 쓸 수 없는 이름(전역·바깥·시간·난수·코드 만들기). */
const BANNED_NAMES = new Set([
  'window', 'self', 'top', 'parent', 'frames', 'globalThis', 'global', 'document', 'location', 'navigator', 'history',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'BroadcastChannel', 'postMessage', 'importScripts',
  'eval', 'Function', 'Reflect', 'Proxy', 'require', 'process', 'module', 'exports',
  'Date', 'performance', 'crypto', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'setImmediate',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'alert', 'confirm', 'prompt', 'open', 'close',
  'Object', 'Symbol', 'WeakRef', 'FinalizationRegistry', 'Atomics', 'SharedArrayBuffer', 'arguments', 'this', 'super',
]);
/** 쓸 수 없는 속성 이름(생성자 사슬·프로토타입·난수). */
const BANNED_PROPS = new Set(['constructor', '__proto__', 'prototype', 'random', 'call', 'apply', 'bind', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'defineProperty', 'caller', 'callee']);

/** 한 파일을 문법 나무로 훑어 어긋난 곳을 모은다. */
export function problems(src: string): string[] {
  const sf = ts.createSourceFile('b.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const from = (st.moduleSpecifier as ts.StringLiteral).text;
      if (from !== '../behavior' || !st.importClause?.isTypeOnly) out.push(`${line(st)}줄: import type { Behavior } from '../behavior' 만 쓸 수 있어요`);
    } else if (ts.isExportDeclaration(st)) out.push(`${line(st)}줄: 다른 파일을 다시 내보낼 수 없어요`);
    else if (!(ts.isVariableStatement(st) || ts.isExportAssignment(st) || ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st))) out.push(`${line(st)}줄: 맨 위에는 const, function, export default 만 둘 수 있어요`);
  }
  const walk = (n: ts.Node) => {
    if (ts.isIdentifier(n) && BANNED_NAMES.has(n.text)) {
      const p = n.parent;
      const isMemberName = p && ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isMethodDeclaration(p) && p.name === n));
      if (!isMemberName) out.push(`${line(n)}줄: '${n.text}' 은 쓸 수 없어요(바깥·시간·난수·코드 만들기)`);
    }
    if (ts.isPropertyAccessExpression(n) && BANNED_PROPS.has(n.name.text)) out.push(`${line(n)}줄: '.${n.name.text}' 은 쓸 수 없어요`);
    if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) out.push(`${line(n)}줄: this, super 는 쓸 수 없어요`);
    // 구조 분해로 속성을 꺼내는 것({ constructor } = x)과 금지 이름을 글자로 적는 것도 막는다
    if (ts.isObjectBindingPattern(n)) out.push(`${line(n)}줄: { a } = x 처럼 꺼내 쓰는 것은 쓸 수 없어요. ctx.vars 처럼 점으로 적어 주세요`);
    if (ts.isStringLiteralLike(n) && (BANNED_PROPS.has(n.text) || BANNED_NAMES.has(n.text))) out.push(`${line(n)}줄: 글자 '${n.text}' 는 쓸 수 없어요`);
    if (ts.isComputedPropertyName(n)) out.push(`${line(n)}줄: [ ] 로 이름을 만드는 속성은 쓸 수 없어요`);
    // [ ] 로 고르는 것은 숫자 칸(ctx.vars[k], 배열[0])만. 변수에 담은 글자로 속성을 고르는 우회를 막는다
    const ctxVars = (e: ts.Expression) => ts.isPropertyAccessExpression(e) && e.name.text === 'vars' && ts.isIdentifier(e.expression) && e.expression.text === 'ctx';
    if (ts.isElementAccessExpression(n) && !ctxVars(n.expression))
      out.push(`${line(n)}줄: [ ] 로는 ctx.vars 의 칸(ctx.vars[0] 같은 것)만 고를 수 있어요. 속성은 점(.)으로 이름을 적어 주세요`);
    if (ts.isMetaProperty(n) || n.kind === ts.SyntaxKind.ImportKeyword && !ts.isImportDeclaration(n.parent)) out.push(`${line(n)}줄: import.meta 나 import() 는 쓸 수 없어요`);
    if (ts.isWhileStatement(n) || ts.isDoStatement(n) || (ts.isForStatement(n) && !n.condition)) out.push(`${line(n)}줄: while, do, 끝 조건 없는 for 는 쓸 수 없어요(판이 멈출 수 있어요). for (let k = 0; k < 10; k++) 처럼 횟수를 정해 주세요`);
    if (ts.isNewExpression(n)) out.push(`${line(n)}줄: new 로 무언가를 만들 수 없어요`);
    if (ts.isTaggedTemplateExpression(n)) out.push(`${line(n)}줄: 꼬리표 붙은 글자 틀은 쓸 수 없어요`);
    if (ts.isRegularExpressionLiteral(n)) out.push(`${line(n)}줄: 정규식은 쓸 수 없어요`);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

describe('새 움직임 파일', () => {
  it('파일 이름은 영문 소문자·숫자·줄표이고, 모두 판에 실린다', () => {
    for (const f of files) {
      expect(f, '이름은 영문 소문자·숫자·줄표 40자까지').toMatch(/^[a-z0-9-]{1,40}\.ts$/);
      expect(BEHAVIORS[f.replace(/\.ts$/, '')], `${f}: export default 로 { about, ... } 를 내보내 주세요`).toBeTruthy();
    }
  });
  it.each(files)('%s: 판의 손잡이만 쓰고 바깥·시간·난수·끝없는 반복을 쓰지 않는다', f => {
    expect(problems(readFileSync(join(dir, f), 'utf8')), f).toEqual([]);
  });
});

describe('검사 그물이 실제로 거른다', () => {
  const ok = "import type { Behavior } from '../behavior';\nconst b: Behavior = { about: 'x', use: ctx => { ctx.vars[0] = ctx.vars[0] ? 0 : 1; return true; } };\nexport default b;\n";
  it('본보기 모양은 통과한다', () => { expect(problems(ok)).toEqual([]); });
  it.each([
    ['생성자 사슬', "const f = (x: any) => x.isOn.constructor('return this')();"],
    ['다른 전역 이름', "const g = self;"],
    ['글자 조립 접근', "const g = (globalThis as any)['fe' + 'tch'];"],
    ['글자로 속성 고르기', "const h = (Math as any)['random'];"],
    ['변수에 담은 글자로 고르기', "const k = 'con' + 'structor'; const f = (x: any) => x.isOn[k];"],
    ['문자열 속 주석 기호 뒤 fetch', "const a = '/*'; fetch('x'); const z = '*/';"],
    ['공백 없는 import', "import'../../src/net';"],
    ['다시 내보내기', "export * from '../../src/main';"],
    ['import.meta', "const m = import.meta;"],
    ['동적 import', "const m = import('../../src/main');"],
    ['끝없는 반복', "function t() { for (;;) {} }"],
    ['while', "function t() { while (1) {} }"],
    ['맨 위 실행', "console.log(1);"],
    ['시간', "const n = Date.now();"],
    ['난수', "const r = Math.random();"],
    ['new', "const x = new Array(1e9);"],
    ['type 아닌 import', "import { BEHAVIORS } from '../behavior';"],
    ['구조 분해로 constructor', "const f = (x: any) => { const { constructor: c } = x.isOn; return c; };"],
    ['Object 로 프로토타입 꺼내기', "const f = (x: any) => Object.getPrototypeOf(x);"],
    ['글자로 적은 금지 이름', "const k = 'constructor';"],
    ['ctx 가 아닌 vars 고르기', "const f = (o: any, k: number) => o.vars[k];"],
    ['this', "function t(this: any) { return this; }"],
  ])('%s 은 걸린다', (_, src) => { expect(problems(src).length).toBeGreaterThan(0); });
});
