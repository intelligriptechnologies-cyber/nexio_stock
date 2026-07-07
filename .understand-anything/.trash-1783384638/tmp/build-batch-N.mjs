// build-batch-N.mjs
// Usage: node build-batch-N.mjs <projectRoot> <batchIndex>
//
// Adapts a single `extract-structure.mjs` output into the batch-*.json format
// the merge script expects. Used as a Phase 2 inline fallback when file-analyzer
// subagents all 90s-timeout — see references/phase2-inline-fallback.md for the
// full recipe and verification contract.
//
// Required inputs (must already exist on disk):
//   <projectRoot>/.understand-anything/tmp/ua-file-analyzer-input-<N>.json
//   <projectRoot>/.understand-anything/tmp/ua-file-extract-results-<N>.json
//
// Output:
//   <projectRoot>/.understand-anything/intermediate/batch-<N>.json
//
// Filtering rules (must match file-analyzer spec):
//   function nodes: loc >= 10
//   class nodes:    methods >= 2 OR loc >= 20
//   imports edges:  1:1 from batchImportData, filtered to same-batch endpoints
//   contains edges: one per non-file child node
//
// Filename rule: batch-<N>.json (or batch-<N>-part-<K>.json if split) — see the
// "Batch output naming" pitfall in SKILL.md. Anything else is silently dropped
// by merge-batch-graphs.py.

import { readFileSync, writeFileSync } from 'node:fs';

const [,, PROJ, N_RAW] = process.argv;
if (!PROJ || !N_RAW) {
  console.error('Usage: node build-batch-N.mjs <projectRoot> <batchIndex>');
  process.exit(1);
}
const N = +N_RAW;

const TMP     = `${PROJ}/.understand-anything/tmp`;
const INTER   = `${PROJ}/.understand-anything/intermediate`;
const input   = JSON.parse(readFileSync(`${TMP}/ua-file-analyzer-input-${N}.json`,     'utf-8'));
const extract = JSON.parse(readFileSync(`${TMP}/ua-file-extract-results-${N}.json`,      'utf-8'));
const importData = input.batchImportData || {};

// --- File nodes (one per input file) ---
const nodes = input.batchFiles.map(f => ({
  id: `file:${f.path}`,
  type: 'file',
  path: f.path,
  language: f.language,
  fileCategory: f.fileCategory,
  totalLines: f.sizeLines,
  label: f.path.split('/').pop(),
}));

// --- Function / class nodes (significance filter) ---
for (const r of extract.results) {
  for (const fn of (r.functions || [])) {
    const loc = fn.endLine - fn.startLine + 1;
    if (loc < 10) continue;
    nodes.push({
      id: `function:${r.path}:${fn.name}`,
      type: 'function',
      path: r.path,
      name: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      loc,
      params: fn.params || [],
      label: fn.name,
    });
  }
  for (const cls of (r.classes || [])) {
    const loc   = cls.endLine - cls.startLine + 1;
    const methods = cls.methods || [];
    if (methods.length < 2 && loc < 20) continue;
    nodes.push({
      id: `class:${r.path}:${cls.name}`,
      type: 'class',
      path: r.path,
      name: cls.name,
      startLine: cls.startLine,
      endLine: cls.endLine,
      loc,
      methodCount: methods.length,
      methods,
      label: cls.name,
    });
  }
}

// --- contains edges: file -> function/class ---
const childToFile = new Map(nodes.filter(n => n.type !== 'file').map(n => [n.id, n.path]));
const edges = [...childToFile].map(([child, filePath]) => ({
  source: `file:${filePath}`,
  target: child,
  relation: 'contains',
}));

// --- imports edges (same-batch only) ---
const fileSet = new Set(input.batchFiles.map(f => f.path));
const crossBatchDrops = [];
for (const [from, deps] of Object.entries(importData)) {
  for (const to of deps) {
    if (!fileSet.has(from) || !fileSet.has(to)) {
      crossBatchDrops.push({ from, to });
      continue;
    }
    edges.push({ source: `file:${from}`, target: `file:${to}`, relation: 'imports' });
  }
}

const out = {
  batchIndex: N,
  projectRoot: PROJ,
  filesAnalyzed: extract.filesAnalyzed,
  filesSkipped: extract.filesSkipped || [],
  scriptCompleted: extract.scriptCompleted,
  nodes,
  edges,
  summary: {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    fileNodes:      nodes.filter(n => n.type === 'file').length,
    functionNodes:  nodes.filter(n => n.type === 'function').length,
    classNodes:     nodes.filter(n => n.type === 'class').length,
    importsEdges:   edges.filter(e => e.relation === 'imports').length,
    containsEdges:  edges.filter(e => e.relation === 'contains').length,
    crossBatchDrops: crossBatchDrops.length,
    crossBatchDropList: crossBatchDrops,
    skippedFiles: (extract.filesSkipped || []).length,
    splits: [],
  },
};

writeFileSync(`${INTER}/batch-${N}.json`, JSON.stringify(out, null, 2));
console.log(
  `batch-${N}.json: ${out.summary.fileNodes} files, ` +
  `${out.summary.functionNodes} functions, ${out.summary.classNodes} classes, ` +
  `${out.summary.importsEdges} imports (${crossBatchDrops.length} cross-batch dropped), ` +
  `${out.summary.containsEdges} contains`
);

// exit non-zero if significance-filter results don't match raw extract (signals the
// caller should re-check the spec or its inputs)
const rawFunctions = extract.results.flatMap(r => (r.functions || []));
const rawClasses   = extract.results.flatMap(r => (r.classes || []));
const expectedFns  = rawFunctions.filter(fn => (fn.endLine - fn.startLine + 1) >= 10).length;
const expectedCls  = rawClasses.filter(c => ((c.methods||[]).length >= 2 || (c.endLine - c.startLine + 1) >= 20)).length;
if (out.summary.functionNodes !== expectedFns || out.summary.classNodes !== expectedCls) {
  console.error(`MISMATCH: functionNodes=${out.summary.functionNodes} expected=${expectedFns}, classNodes=${out.summary.classNodes} expected=${expectedCls}`);
  process.exit(2);
}
