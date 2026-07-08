const fs = require('fs');
const path = require('path');

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const { nodes, edges, layers } = raw;
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  for (const e of edges) {
    if (fanOut.has(e.source)) fanOut.set(e.source, fanOut.get(e.source) + 1);
    if (fanIn.has(e.target)) fanIn.set(e.target, fanIn.get(e.target) + 1);
  }

  const fanInRanking = [...fanIn.entries()]
    .map(([id, v]) => ({ id, fanIn: v, name: nodeById.get(id)?.name }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  const fanOutRanking = [...fanOut.entries()]
    .map(([id, v]) => ({ id, fanOut: v, name: nodeById.get(id)?.name }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // Entry point candidates
  const entryFilenames = new Set(['index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js',
    'mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py','__main__.py',
    'Application.java','Main.java','Program.cs','config.ru','index.php','App.swift','Application.kt','main.cpp','main.c']);

  const fanOutVals = [...fanOut.values()].sort((a,b)=>b-a);
  const fanOutTop10Threshold = fanOutVals[Math.max(0, Math.floor(fanOutVals.length * 0.1) - 1)] ?? 0;
  const fanInVals = [...fanIn.values()].sort((a,b)=>a-b);
  const fanInBottom25Threshold = fanInVals[Math.floor(fanInVals.length * 0.25)] ?? 0;

  const entryPointCandidates = [];
  for (const n of nodes) {
    let score = 0;
    const fp = (n.filePath || '').replace(/\\/g, '/');
    const depth = fp.split('/').filter(Boolean).length;
    if (n.type === 'document') {
      if (fp === 'README.md') score += 5;
      else if (/^[^/]+\.md$/.test(fp)) score += 2;
    } else {
      if (entryFilenames.has(n.name)) score += 3;
      if (depth <= 2) score += 1;
      if (fanOut.get(n.id) >= fanOutTop10Threshold && fanOutTop10Threshold > 0) score += 1;
      if (fanIn.get(n.id) <= fanInBottom25Threshold) score += 1;
    }
    if (score > 0) entryPointCandidates.push({ id: n.id, score, name: n.name, summary: n.summary });
  }
  entryPointCandidates.sort((a, b) => b.score - a.score);
  const topEntryPointCandidates = entryPointCandidates.slice(0, 5);

  // BFS from top code entry point (skip documents)
  const codeEntryCandidates = entryPointCandidates.filter(c => nodeById.get(c.id).type !== 'document');
  const startNode = codeEntryCandidates.length ? codeEntryCandidates[0].id : (nodes[0] && nodes[0].id);

  const adjacency = new Map();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    if ((e.type === 'imports' || e.type === 'calls') && adjacency.has(e.source)) {
      adjacency.get(e.source).push(e.target);
    }
  }

  const depthMap = {};
  const order = [];
  if (startNode) {
    const visited = new Set([startNode]);
    let queue = [{ id: startNode, depth: 0 }];
    while (queue.length) {
      const { id, depth } = queue.shift();
      order.push(id);
      depthMap[id] = depth;
      const neighbors = adjacency.get(id) || [];
      for (const nb of neighbors) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push({ id: nb, depth: depth + 1 });
        }
      }
    }
  }
  const byDepth = {};
  for (const [id, d] of Object.entries(depthMap)) {
    byDepth[d] = byDepth[d] || [];
    byDepth[d].push(id);
  }

  // Non-code file inventory
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    const entry = { id: n.id, name: n.name, type: n.type, summary: n.summary };
    if (n.type === 'document') nonCodeFiles.documentation.push(entry);
    else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push(entry);
    else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push(entry);
    else if (n.type === 'config') nonCodeFiles.config.push(entry);
  }

  // Clusters: bidirectional relationships
  const edgeKeySet = new Set(edges.map(e => `${e.source}|${e.target}|${e.type}`));
  const biPairs = [];
  for (const e of edges) {
    if (e.type !== 'imports' && e.type !== 'calls') continue;
    const reverseKey = `${e.target}|${e.source}|${e.type}`;
    if (edgeKeySet.has(reverseKey) && e.source < e.target) {
      biPairs.push([e.source, e.target]);
    }
  }
  // union-find style cluster expansion
  const clusterMap = new Map(); // node -> cluster set (array index)
  const clusters = [];
  for (const [a, b] of biPairs) {
    let ca = clusterMap.get(a);
    let cb = clusterMap.get(b);
    if (ca === undefined && cb === undefined) {
      const idx = clusters.length;
      clusters.push(new Set([a, b]));
      clusterMap.set(a, idx);
      clusterMap.set(b, idx);
    } else if (ca !== undefined && cb === undefined) {
      clusters[ca].add(b); clusterMap.set(b, ca);
    } else if (ca === undefined && cb !== undefined) {
      clusters[cb].add(a); clusterMap.set(a, cb);
    } else if (ca !== cb) {
      for (const n of clusters[cb]) { clusters[ca].add(n); clusterMap.set(n, ca); }
      clusters[cb] = new Set();
    }
  }
  // Expand: add nodes connecting to 2+ existing cluster members
  const nonEmptyClusters = clusters.filter(c => c.size > 0);
  for (const cluster of nonEmptyClusters) {
    let changed = true;
    while (changed && cluster.size < 5) {
      changed = false;
      const counts = new Map();
      for (const e of edges) {
        if (cluster.has(e.source) && !cluster.has(e.target)) {
          counts.set(e.target, (counts.get(e.target) || 0) + 1);
        }
        if (cluster.has(e.target) && !cluster.has(e.source)) {
          counts.set(e.source, (counts.get(e.source) || 0) + 1);
        }
      }
      for (const [id, count] of counts.entries()) {
        if (count >= 2 && cluster.size < 5) {
          cluster.add(id);
          changed = true;
        }
      }
    }
  }
  function countEdgesWithin(nodeSet) {
    let c = 0;
    for (const e of edges) if (nodeSet.has(e.source) && nodeSet.has(e.target)) c++;
    return c;
  }
  const clusterOutput = nonEmptyClusters
    .filter(c => c.size >= 2 && c.size <= 5)
    .map(c => ({ nodes: [...c], edgeCount: countEdgesWithin(c) }))
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, 10);

  // Node summary index
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
  }

  const result = {
    scriptCompleted: true,
    entryPointCandidates: topEntryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: { startNode, order, depthMap, byDepth },
    nonCodeFiles,
    clusters: clusterOutput,
    layers: { count: layers.length, list: layers },
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log('OK');
}

try {
  main();
} catch (err) {
  console.error(err.stack || String(err));
  process.exit(1);
}
