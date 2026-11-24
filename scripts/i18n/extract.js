// TypeScript AST 로 화면에 나갈 수 있는 한글 문자열을 뽑습니다.
const ts = require('/home/claude/repo/dh-smartpower-dashboard/node_modules/typescript');
const fs = require('fs'), path = require('path');
const ROOT = '/home/claude/repo/dh-smartpower-dashboard';
const H = /[가-힣]/;
const out = new Map(); // key -> {kind, files:Set}
function add(key, kind, file) {
  key = key.replace(/\s+/g, ' ').trim();
  if (!key || !H.test(key)) return;
  const e = out.get(key) || { kind, files: new Set() };
  e.files.add(path.relative(ROOT, file)); out.set(key, e);
}
function skipCall(node) {
  // console.log / log(...) / SQL 등은 제외
  let p = node.parent;
  for (let i = 0; i < 3 && p; i++, p = p.parent) {
    if (ts.isCallExpression(p)) {
      const t = p.expression.getText();
      if (/^(console\.\w+|log|query|one|execute|pool\.query|client\.query|cur\.execute)$/.test(t)) return true;
    }
  }
  return false;
}
function walk(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(n) {
    if (ts.isJsxText(n)) {
      add(n.getText(), 'jsx', file);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!skipCall(n) && !(n.parent && ts.isImportDeclaration(n.parent))) add(n.text, 'str', file);
    } else if (ts.isTemplateExpression(n)) {
      if (!skipCall(n)) {
        let s = n.head.text; let i = 0;
        for (const sp of n.templateSpans) { s += `{${i++}}` + sp.literal.text; }
        if (H.test(s)) add(s, 'tpl', file);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
function rec(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(p)) rec(p); }
    else if (/\.(tsx?|mjs)$/.test(f)) walk(p);
  }
}
for (const d of ['app', 'components', 'lib', 'cs-engine']) rec(path.join(ROOT, d));
const arr = [...out.entries()].map(([k, v]) => ({ k, kind: v.kind, files: [...v.files] }));
fs.writeFileSync('/home/claude/i18n/keys.json', JSON.stringify(arr, null, 1));
console.log(arr.length, arr.filter(a => a.kind === 'tpl').length, arr.reduce((s, a) => s + a.k.length, 0));
