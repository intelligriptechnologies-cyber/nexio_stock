const fs = require('fs');

function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(raw);
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // Fan-in / fan-out (all edges)
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  for (const e of edges) {
    if (fanOut.has(e.source)) fanOut.set(e.source, fanOut.get(e.source) + 1);
    if (fanIn.has(e.target)) fanIn.set(e.target, fanIn.get(e.target) + 1);
  }

  const fanInRanking = [...fanIn.entries()]
    .map(([id, v]) => ({ id, fanIn: v, name: nodeById.get(id) ? nodeById.get(id).name : id }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  const fanOutRanking = [...fanOut.entries()]
    .map(([id, v]) => ({ id, fanOut: v, name: nodeById.get(id) ? nodeById.get(id).name : id }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // Entry point candidates
  const entryFilenames = new Set(['index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js','mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py','__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php','App.swift','Application.kt','main.cpp','main.c']);

  const fanOutVals = [...fanOut.values()].sort((a, b) => b - a);
  const fanOutTop10Threshold = fanOutVals.length ? fanOutVals[Math.max(0, Math.floor(fanOutVals.length * 0.1) - 1)] : 0;
  const fanInVals = [...fanIn.values()].sort((a, b) => a - b);
  const fanInBottom25Threshold = fanInVals.length ? fanInVals[Math.min(fanInVals.length - 1, Math.floor(fanInVals.length * 0.25))] : 0;

  const entryScores = [];
  for (const n of nodes) {
    let score = 0;
    const filePath = n.filePath || '';
    const depth = filePath.split('/').filter(Boolean).length;
    if (n.type === 'document') {
      if (/^readme\.md$/i.test(n.name) && depth <= 1) score += 5;
      else if (/\.md$/i.test(n.name) && depth <= 1) score += 2;
    } else if (n.type === 'file') {
      if (entryFilenames.has(n.name)) score += 3;
      if (depth <= 2) score += 1;
      if (fanOut.get(n.id) >= fanOutTop10Threshold && fanOutTop10Threshold > 0) score += 1;
      if (fanIn.get(n.id) <= fanInBottom25Threshold) score += 1;
    }
    if (score > 0) entryScores.push({ id: n.id, score, name: n.name, summary: n.summary });
  }
  entryScores.sort((a, b) => b.score - a.score);
  const entryPointCandidates = entryScores.slice(0, 5);

  // BFS from top code entry point (skip documents)
  const topCodeEntry = entryScores.find(e => {
    const nd = nodeById.get(e.id);
    return nd && nd.type !== 'document';
  });

  const bfsResult = { startNode: null, order: [], depthMap: {}, byDepth: {} };
  if (topCodeEntry) {
    const start = topCodeEntry.id;
    bfsResult.startNode = start;
    const adjForward = new Map();
    for (const e of edges) {
      if (e.type === 'imports' || e.type === 'calls') {
        if (!adjForward.has(e.source)) adjForward.set(e.source, []);
        adjForward.get(e.source).push(e.target);
      }
    }
    const visited = new Set([start]);
    const queue = [[start, 0]];
    let qi = 0;
    while (qi < queue.length) {
      const [cur, depth] = queue[qi++];
      bfsResult.order.push(cur);
      bfsResult.depthMap[cur] = depth;
      if (!bfsResult.byDepth[depth]) bfsResult.byDepth[depth] = [];
      bfsResult.byDepth[depth].push(cur);
      const neighbors = adjForward.get(cur) || [];
      for (const nb of neighbors) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push([nb, depth + 1]);
        }
      }
    }
  }

  // Non-code file inventory
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    if (n.type === 'document') {
      nonCodeFiles.documentation.push({ id: n.id, name: n.name, summary: n.summary });
    } else if (n.type === 'service' || n.type === 'pipeline' || n.type === 'resource') {
      nonCodeFiles.infrastructure.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
    } else if (n.type === 'table' || n.type === 'schema' || n.type === 'endpoint') {
      nonCodeFiles.data.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
    } else if (n.type === 'config') {
      nonCodeFiles.config.push({ id: n.id, name: n.name, summary: n.summary });
    }
  }

  // Tightly coupled clusters
  const edgeSet = new Set(edges.map(e => `${e.source}=>${e.target}=>${e.type}`));
  const pairEdgeCount = new Map();
  function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  const bidirPairs = [];
  for (const e of edges) {
    if (e.type !== 'imports' && e.type !== 'calls') continue;
    const rev = `${e.target}=>${e.source}=>${e.type}`;
    if (edgeSet.has(rev)) {
      bidirPairs.push([e.source, e.target]);
    }
    const key = pairKey(e.source, e.target);
    pairEdgeCount.set(key, (pairEdgeCount.get(key) || 0) + 1);
  }

  // union-find style clustering from bidir pairs
  const parent = new Map();
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  function union(a, b) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const [a, b] of bidirPairs) union(a, b);

  const clusterGroups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!clusterGroups.has(root)) clusterGroups.set(root, new Set());
    clusterGroups.get(root).add(id);
  }

  // expand: add nodes connecting to 2+ existing members
  for (const [root, members] of clusterGroups) {
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 5) {
      changed = false;
      iterations++;
      const connCount = new Map();
      for (const e of edges) {
        if (e.type !== 'imports' && e.type !== 'calls') continue;
        if (members.has(e.source) && !members.has(e.target)) {
          connCount.set(e.target, (connCount.get(e.target) || 0) + 1);
        }
        if (members.has(e.target) && !members.has(e.source)) {
          connCount.set(e.source, (connCount.get(e.source) || 0) + 1);
        }
      }
      for (const [cand, cnt] of connCount) {
        if (cnt >= 2 && members.size < 5) {
          members.add(cand);
          changed = true;
        }
      }
    }
  }

  let clusters = [];
  for (const [root, members] of clusterGroups) {
    const memberArr = [...members];
    if (memberArr.length < 2) continue;
    let edgeCount = 0;
    for (const e of edges) {
      if (members.has(e.source) && members.has(e.target)) edgeCount++;
    }
    clusters.push({ nodes: memberArr, edgeCount });
  }
  clusters.sort((a, b) => b.edgeCount - a.edgeCount);
  clusters = clusters.slice(0, 10);

  // Layers
  const layersOut = { count: layers.length, list: layers.map(l => ({ id: l.id, name: l.name, description: l.description })) };

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
    bfsTraversal: bfsResult,
    nonCodeFiles,
    clusters,
    layers: layersOut,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
