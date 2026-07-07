const fs = require('fs');

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error('Failed to read/parse input: ' + e.message);
    process.exit(1);
  }

  try {
    const nodes = data.nodes || [];
    const edges = data.edges || [];
    const layers = data.layers || [];

    // Only consider file/config/document/service/pipeline/table/schema/resource/endpoint nodes
    // for graph analysis (function/class sub-nodes are structural detail, not tour stops)
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    // Restrict analysis to top-level nodes (file, config, document, service, pipeline, table, schema, resource, endpoint)
    const topLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
    const topLevelIds = new Set(nodes.filter(n => topLevelTypes.has(n.type)).map(n => n.id));

    // Fan-in / fan-out counts among top-level nodes, using file-to-file edges (imports, calls resolved to file via containment, depends_on, configures, documents, deploys)
    // We'll compute fan-in/out directly on edges where both source and target are top-level nodes.
    const fanIn = new Map();
    const fanOut = new Map();
    for (const id of topLevelIds) { fanIn.set(id, 0); fanOut.set(id, 0); }

    const fileEdges = []; // edges between top-level nodes only
    for (const e of edges) {
      if (topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
        fileEdges.push(e);
        fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
        fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
      }
    }

    const fanInRanking = [...fanIn.entries()]
      .map(([id, count]) => ({ id, fanIn: count, name: nodeById.get(id)?.name }))
      .sort((a, b) => b.fanIn - a.fanIn)
      .slice(0, 20);

    const fanOutRanking = [...fanOut.entries()]
      .map(([id, count]) => ({ id, fanOut: count, name: nodeById.get(id)?.name }))
      .sort((a, b) => b.fanOut - a.fanOut)
      .slice(0, 20);

    // Entry point candidates
    const entryFilenames = new Set(['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js',
      'mod.rs', 'main.go', 'main.py', 'main.rs', 'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'run.py', '__main__.py',
      'Application.java', 'Main.java', 'Program.cs', 'config.ru', 'index.php', 'App.swift', 'Application.kt', 'main.cpp', 'main.c']);

    const fanOutValues = [...fanOut.values()].sort((a, b) => b - a);
    const fanOutTop10Threshold = fanOutValues.length ? fanOutValues[Math.max(0, Math.floor(fanOutValues.length * 0.1) - 1)] : 0;
    const fanInValues = [...fanIn.values()].sort((a, b) => a - b);
    const fanInBottom25Threshold = fanInValues.length ? fanInValues[Math.floor(fanInValues.length * 0.25)] : 0;

    const entryPointCandidates = [];
    for (const n of nodes) {
      if (!topLevelTypes.has(n.type)) continue;
      let score = 0;
      const fp = n.filePath || '';
      const depth = fp.split('/').filter(Boolean).length;
      if (n.type === 'document' && n.name === 'README.md' && depth <= 1) {
        score += 5;
      } else if (n.type === 'document' && /\.md$/i.test(n.name) && depth <= 1) {
        score += 2;
      }
      if (entryFilenames.has(n.name)) score += 3;
      if (depth <= 2) score += 1;
      const fo = fanOut.get(n.id) || 0;
      const fi = fanIn.get(n.id) || 0;
      if (fo >= fanOutTop10Threshold && fo > 0) score += 1;
      if (fi <= fanInBottom25Threshold) score += 1;
      if (score > 0) entryPointCandidates.push({ id: n.id, score, name: n.name, summary: n.summary });
    }
    entryPointCandidates.sort((a, b) => b.score - a.score);
    const topEntryCandidates = entryPointCandidates.slice(0, 5);

    // BFS from top code entry point (skip document nodes)
    const codeEntryCandidates = entryPointCandidates.filter(c => nodeById.get(c.id)?.type !== 'document');
    const startNode = codeEntryCandidates.length ? codeEntryCandidates[0].id : (topEntryCandidates[0] ? topEntryCandidates[0].id : null);

    const adjImportsCalls = new Map();
    for (const e of edges) {
      if ((e.type === 'imports' || e.type === 'calls') && topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
        if (!adjImportsCalls.has(e.source)) adjImportsCalls.set(e.source, []);
        adjImportsCalls.get(e.source).push(e.target);
      }
    }
    // Also need imports edges where target might be function-level resolved to file - but we restricted to topLevel only.
    // Since function-level calls edges don't connect file-to-file directly in our filtered set (source/target both top-level),
    // rely on file-level 'imports' edges primarily.

    const bfsOrder = [];
    const depthMap = {};
    if (startNode) {
      const visited = new Set([startNode]);
      const queue = [[startNode, 0]];
      while (queue.length) {
        const [cur, d] = queue.shift();
        bfsOrder.push(cur);
        depthMap[cur] = d;
        const neighbors = adjImportsCalls.get(cur) || [];
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push([nb, d + 1]);
          }
        }
      }
    }
    const byDepth = {};
    for (const [id, d] of Object.entries(depthMap)) {
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(id);
    }

    // Non-code file inventory
    const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
    for (const n of nodes) {
      if (n.type === 'document') nonCodeFiles.documentation.push({ id: n.id, name: n.name, summary: n.summary });
      else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
      else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push({ id: n.id, name: n.name, type: n.type, summary: n.summary });
      else if (n.type === 'config') nonCodeFiles.config.push({ id: n.id, name: n.name, summary: n.summary });
    }

    // Clusters: bidirectional relationships among top-level nodes (imports/calls), expand by 2+ connections
    const edgeSet = new Set(fileEdges.map(e => `${e.source}=>${e.target}:${e.type}`));
    const pairKey = (a, b) => [a, b].sort().join('|');
    const bidirPairs = new Set();
    const adjAll = new Map();
    for (const e of fileEdges) {
      if (e.type === 'imports' || e.type === 'calls') {
        if (!adjAll.has(e.source)) adjAll.set(e.source, new Set());
        adjAll.get(e.source).add(e.target);
      }
    }
    for (const [a, targets] of adjAll.entries()) {
      for (const b of targets) {
        if (adjAll.has(b) && adjAll.get(b).has(a) && a !== b) {
          bidirPairs.add(pairKey(a, b));
        }
      }
    }
    // Build initial clusters from bidir pairs
    let clusterList = [...bidirPairs].map(k => new Set(k.split('|')));
    // Merge overlapping clusters
    function mergeClusters(clusters) {
      let merged = true;
      while (merged) {
        merged = false;
        outer:
        for (let i = 0; i < clusters.length; i++) {
          for (let j = i + 1; j < clusters.length; j++) {
            const a = clusters[i], b = clusters[j];
            let overlap = false;
            for (const x of a) if (b.has(x)) { overlap = true; break; }
            if (overlap) {
              clusters[i] = new Set([...a, ...b]);
              clusters.splice(j, 1);
              merged = true;
              break outer;
            }
          }
        }
      }
      return clusters;
    }
    clusterList = mergeClusters(clusterList);

    // Expand: add nodes connecting to 2+ existing members (undirected, imports/calls)
    const undirectedAdj = new Map();
    for (const e of fileEdges) {
      if (e.type === 'imports' || e.type === 'calls') {
        if (!undirectedAdj.has(e.source)) undirectedAdj.set(e.source, new Set());
        if (!undirectedAdj.has(e.target)) undirectedAdj.set(e.target, new Set());
        undirectedAdj.get(e.source).add(e.target);
        undirectedAdj.get(e.target).add(e.source);
      }
    }
    for (const cluster of clusterList) {
      let changed = true;
      while (changed && cluster.size < 5) {
        changed = false;
        const candidateCounts = new Map();
        for (const member of cluster) {
          const neighbors = undirectedAdj.get(member) || new Set();
          for (const nb of neighbors) {
            if (!cluster.has(nb)) {
              candidateCounts.set(nb, (candidateCounts.get(nb) || 0) + 1);
            }
          }
        }
        for (const [cand, count] of candidateCounts.entries()) {
          if (count >= 2 && cluster.size < 5) {
            cluster.add(cand);
            changed = true;
          }
        }
      }
    }

    // Compute edge counts within each cluster
    const clusters = clusterList
      .filter(c => c.size >= 2 && c.size <= 5)
      .map(c => {
        const nodesArr = [...c];
        let edgeCount = 0;
        for (const e of fileEdges) {
          if (c.has(e.source) && c.has(e.target) && (e.type === 'imports' || e.type === 'calls')) edgeCount++;
        }
        return { nodes: nodesArr, edgeCount };
      })
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, 10);

    // Layers
    const layersOut = { count: layers.length, list: layers.map(l => ({ id: l.id, name: l.name, description: l.description })) };

    // Node summary index (all node types)
    const nodeSummaryIndex = {};
    for (const n of nodes) {
      nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
    }

    const result = {
      scriptCompleted: true,
      entryPointCandidates: topEntryCandidates,
      fanInRanking,
      fanOutRanking,
      bfsTraversal: {
        startNode,
        order: bfsOrder,
        depthMap,
        byDepth
      },
      nonCodeFiles,
      clusters,
      layers: layersOut,
      nodeSummaryIndex,
      totalNodes: nodes.length,
      totalEdges: edges.length
    };

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Fatal error during analysis: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
}

main();
