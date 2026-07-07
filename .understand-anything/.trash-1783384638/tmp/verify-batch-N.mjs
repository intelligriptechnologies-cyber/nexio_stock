// verify-batch-N.mjs
// Usage: node verify-batch-N.mjs <projectRoot> <batchIndex>
//
// Structural verifier for a single batch-*.json emitted by build-batch-N.mjs.
// Catches the failure modes that would otherwise survive into the merge step
// silently: dangling edges, filter-rule regressions, stale on-disk writes.
//
// Pass criteria: every check passes (typically 350–400 checks for a 10-file
// Python batch). Exits 0 on success, 1 on any failure.

import { readFileSync } from 'node:fs';

const [,, PROJ, N_RAW] = process.argv;
if (!PROJ || !N_RAW) { console.error('Usage: node verify-batch-N.mjs <projectRoot> <batchIndex>'); process.exit(1); }
const N = +N_RAW;

const TMP   = `${PROJ}/.understand-anything/tmp`;
const INTER = `${PROJ}/.understand-anything/intermediate`;
const batch  = JSON.parse(readFileSync(`${INTER}/batch-${N}.json`,                            'utf-8'));
const ext    = JSON.parse(readFileSync(`${TMP}/ua-file-extract-results-${N}.json`,            'utf-8'));
const input  = JSON.parse(readFileSync(`${TMP}/ua-file-analyzer-input-${N}.json`,            'utf-8'));

const errors = [];
const checks = [];
const check = (name, cond, detail = '') => {
  checks.push({ name, ok: !!cond, detail });
  if (!cond) errors.push(`${name}${detail ? ': ' + detail : ''}`);
};

// 1. Basic shape — guard against stale on-disk files where summary was patched
//    but never re-built (crashes verifier with undefined.functionNodes).
check('scriptCompleted is true',             batch.scriptCompleted === true);
check('batchIndex is N',                     batch.batchIndex === N, `got=${batch.batchIndex} expected=${N}`);
check('filesAnalyzed matches extract',       batch.filesAnalyzed === ext.filesAnalyzed, `batch=${batch.filesAnalyzed} extract=${ext.filesAnalyzed}`);
check('filesSkipped is empty',               Array.isArray(batch.filesSkipped) && batch.filesSkipped.length === 0);

// 2. Node id format & uniqueness
const ids = new Set();
const fileRe     = /^file:.+$/;
const functionRe = /^function:.+:.+$/;
const classRe    = /^class:.+:.+$/;
for (const n of batch.nodes) {
  check(`unique id ${n.id}`, !ids.has(n.id));
  ids.add(n.id);
  if (n.type === 'file')     check(`file id format ${n.id}`,     fileRe.test(n.id));
  if (n.type === 'function') check(`function id format ${n.id}`, functionRe.test(n.id));
  if (n.type === 'class')    check(`class id format ${n.id}`,    classRe.test(n.id));
}

// 3. File nodes: one per input file
const inputPaths    = input.batchFiles.map(f => f.path).sort();
const batchFilePaths = batch.nodes.filter(n => n.type === 'file').map(n => n.path).sort();
check('file paths match input', JSON.stringify(inputPaths) === JSON.stringify(batchFilePaths));

// 4. Function filter: loc >= 10
for (const n of batch.nodes.filter(n => n.type === 'function')) {
  check(`function loc>=10: ${n.id}`, n.loc >= 10, `loc=${n.loc}`);
}

// 5. Class filter: methods >= 2 OR loc >= 20
for (const n of batch.nodes.filter(n => n.type === 'class')) {
  check(`class filter ok: ${n.id}`, (n.methodCount >= 2 || n.loc >= 20), `methods=${n.methodCount} loc=${n.loc}`);
}

// 6. Filter rule correctness vs raw extract
const rawFunctions = ext.results.flatMap(r => (r.functions || []).map(fn => ({ ...fn, _path: r.path })));
const rawClasses   = ext.results.flatMap(r => (r.classes   || []).map(c  => ({ ...c,  _path: r.path })));
const expectedFns  = rawFunctions.filter(fn => (fn.endLine - fn.startLine + 1) >= 10).length;
const expectedCls  = rawClasses.filter(c => ((c.methods||[]).length >= 2 || (c.endLine - c.startLine + 1) >= 20)).length;
check('function count matches filter', batch.summary.functionNodes === expectedFns, `got=${batch.summary.functionNodes} expected=${expectedFns}`);
check('class count matches filter',    batch.summary.classNodes    === expectedCls, `got=${batch.summary.classNodes} expected=${expectedCls}`);

// 7. Edge integrity: every source + target resolves to a node id (catches the
//    most common batch-graph bug — cross-batch imports with a dangling target)
for (const e of batch.edges) {
  check(`edge source exists: ${e.source}->${e.target}`, ids.has(e.source));
  check(`edge target exists: ${e.source}->${e.target}`, ids.has(e.target));
}

// 8. imports count + cross-batch drops = batchImportData total
const expectedTotal = Object.values(input.batchImportData || {}).reduce((a, arr) => a + arr.length, 0);
const drops = batch.summary.crossBatchDrops || 0;
check('imports + drops = batchImportData total', batch.summary.importsEdges + drops === expectedTotal, `got=${batch.summary.importsEdges} dropped=${drops} expected=${expectedTotal}`);

// 9. contains count = function + class node count
const containsEdges = batch.edges.filter(e => e.relation === 'contains');
const expectedContains = batch.summary.functionNodes + batch.summary.classNodes;
check('contains count = function+class nodes', containsEdges.length === expectedContains, `got=${containsEdges.length} expected=${expectedContains}`);

// 10. No duplicate edges
const seen = new Set();
for (const e of batch.edges) {
  const k = `${e.source}|${e.target}|${e.relation}`;
  check(`edge unique: ${k}`, !seen.has(k));
  seen.add(k);
}

const ok = checks.filter(c => c.ok).length;
const fail = checks.length - ok;
console.log(`PASS: ${ok} / ${checks.length}`);
console.log(`FAIL: ${fail}`);
if (fail) {
  console.log('\nFailures:');
  for (const e of errors.slice(0, 20)) console.log('  -', e);
  if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`);
  process.exit(1);
}
console.log(`\nAll structural checks passed.`);
console.log(`batch-${N}: nodes=${batch.nodes.length} edges=${batch.edges.length} ` +
  `files=${batch.summary.fileNodes} funcs=${batch.summary.functionNodes} classes=${batch.summary.classNodes} ` +
  `imports=${batch.summary.importsEdges} contains=${batch.summary.containsEdges}`);
