const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) fail('Usage: node ua-tour-analyze.js <input.json> <output.json>');

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (e) {
  fail('Failed to read/parse input: ' + e.message);
}

const nodes = data.nodes || [];
const edges = data.edges || [];
const layers = data.layers || [];

// Only consider file-level nodes for entry-point/BFS/fan-in/out purposes as requested
// (the input here is file-level nodes only, per task description)
const nodeById = new Map(nodes.map(n => [n.id, n]));

// Fan-in / fan-out (count distinct edges, all types, among nodes present in nodeById)
const fanIn = new Map();
const fanOut = new Map();
for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }

for (const e of edges) {
  if (nodeById.has(e.source) && nodeById.has(e.target)) {
    fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
  }
}

const fanInRanking = [...fanIn.entries()]
  .map(([id, count]) => ({ id, fanIn: count, name: nodeById.get(id).name }))
  .sort((a, b) => b.fanIn - a.fanIn)
  .slice(0, 20);

const fanOutRanking = [...fanOut.entries()]
  .map(([id, count]) => ({ id, fanOut: count, name: nodeById.get(id).name }))
  .sort((a, b) => b.fanOut - a.fanOut)
  .slice(0, 20);

// Entry point candidates
const entryFilenames = new Set([
  'index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js',
  'mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py',
  '__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php',
  'App.swift','Application.kt','main.cpp','main.c'
]);

const fanOutVals = [...fanOut.values()].sort((a,b) => b-a);
const fanInVals = [...fanIn.values()].sort((a,b) => a-b);
function percentileThreshold(sortedDesc, pct) {
  const idx = Math.floor(sortedDesc.length * pct);
  return sortedDesc[idx] ?? 0;
}
const top10PctFanOut = percentileThreshold(fanOutVals, 0.10);
const bottom25PctFanIn = fanInVals[Math.floor(fanInVals.length * 0.25)] ?? 0;

const entryScores = [];
for (const n of nodes) {
  let score = 0;
  const fp = (n.filePath || '').replace(/\\/g, '/');
  const depth = fp.split('/').length - 1;
  if (n.type === 'document') {
    if (fp.toLowerCase() === 'readme.md') score += 5;
    else if (depth === 0 && fp.toLowerCase().endsWith('.md')) score += 2;
  } else {
    if (entryFilenames.has(n.name)) score += 3;
    if (depth <= 1) score += 1;
    if ((fanOut.get(n.id) || 0) >= top10PctFanOut && top10PctFanOut > 0) score += 1;
    if ((fanIn.get(n.id) || 0) <= bottom25PctFanIn) score += 1;
  }
  if (score > 0) entryScores.push({ id: n.id, score, name: n.name, summary: n.summary });
}
entryScores.sort((a, b) => b.score - a.score);
const entryPointCandidates = entryScores.slice(0, 5);

// BFS from top code entry point (skip documentation nodes)
const codeEntry = entryScores.find(e => nodeById.get(e.id).type !== 'document');
const bfsAdj = new Map();
for (const n of nodes) bfsAdj.set(n.id, []);
for (const e of edges) {
  if ((e.type === 'imports' || e.type === 'calls') && nodeById.has(e.source) && nodeById.has(e.target)) {
    bfsAdj.get(e.source).push(e.target);
  }
}

let bfsTraversal = { startNode: null, order: [], depthMap: {}, byDepth: {} };
if (codeEntry) {
  const start = codeEntry.id;
  const visited = new Set([start]);
  const order = [start];
  const depthMap = { [start]: 0 };
  const queue = [start];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const neighbors = bfsAdj.get(cur) || [];
    for (const nb of neighbors) {
      if (!nodeById.has(nb)) continue;
      if (!visited.has(nb)) {
        visited.add(nb);
        depthMap[nb] = depthMap[cur] + 1;
        order.push(nb);
        queue.push(nb);
      }
    }
  }
  const byDepth = {};
  for (const [id, d] of Object.entries(depthMap)) {
    byDepth[d] = byDepth[d] || [];
    byDepth[d].push(id);
  }
  bfsTraversal = { startNode: start, order, depthMap, byDepth };
}

// Non-code file inventory
const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
for (const n of nodes) {
  if (n.type === 'document') nonCodeFiles.documentation.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
  else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
  else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
  else if (n.type === 'config') nonCodeFiles.config.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
}

// Tightly coupled clusters
const edgeSet = new Set(edges.map(e => `${e.source}|||${e.target}|||${e.type}`));
function hasEdge(a, b, type) { return edgeSet.has(`${a}|||${b}|||${type}`); }

const bidirPairs = [];
const seenPairs = new Set();
for (const e of edges) {
  if (!(e.type === 'imports' || e.type === 'calls')) continue;
  const rev = hasEdge(e.target, e.source, e.type);
  if (rev && nodeById.has(e.source) && nodeById.has(e.target)) {
    const key = [e.source, e.target].sort().join('|||');
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      bidirPairs.push([e.source, e.target]);
    }
  }
}

// edge count between two nodes (any direction, any type)
function edgeCountBetween(a, b) {
  let c = 0;
  for (const e of edges) {
    if ((e.source === a && e.target === b) || (e.source === b && e.target === a)) c++;
  }
  return c;
}

// build clusters from bidir pairs, then expand
const clusters = [];
const usedNodes = new Set();
for (const [a, b] of bidirPairs) {
  if (usedNodes.has(a) || usedNodes.has(b)) continue;
  const clusterNodes = new Set([a, b]);
  // expand: add nodes connecting to 2+ existing members
  let expanded = true;
  while (expanded && clusterNodes.size < 5) {
    expanded = false;
    const counts = new Map();
    for (const e of edges) {
      if (clusterNodes.has(e.source) && !clusterNodes.has(e.target) && nodeById.has(e.target)) {
        counts.set(e.target, (counts.get(e.target) || 0) + 1);
      }
      if (clusterNodes.has(e.target) && !clusterNodes.has(e.source) && nodeById.has(e.source)) {
        counts.set(e.source, (counts.get(e.source) || 0) + 1);
      }
    }
    for (const [id, cnt] of counts.entries()) {
      if (cnt >= 2 && clusterNodes.size < 5) {
        clusterNodes.add(id);
        expanded = true;
        break;
      }
    }
  }
  const clusterArr = [...clusterNodes];
  let edgeCount = 0;
  for (let i = 0; i < clusterArr.length; i++) {
    for (let j = i + 1; j < clusterArr.length; j++) {
      edgeCount += edgeCountBetween(clusterArr[i], clusterArr[j]);
    }
  }
  clusters.push({ nodes: clusterArr, edgeCount });
  for (const id of clusterArr) usedNodes.add(id);
}
clusters.sort((a, b) => b.edgeCount - a.edgeCount);
const topClusters = clusters.slice(0, 10);

// Node summary index
const nodeSummaryIndex = {};
for (const n of nodes) {
  nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
}

const result = {
  scriptCompleted: true,
  entryPointCandidates,
  fanInRanking,
  fanOutRanking,
  bfsTraversal,
  nonCodeFiles,
  clusters: topClusters,
  layers: { count: layers.length, list: layers },
  nodeSummaryIndex,
  totalNodes: nodes.length,
  totalEdges: edges.length,
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log('OK');
process.exit(0);
