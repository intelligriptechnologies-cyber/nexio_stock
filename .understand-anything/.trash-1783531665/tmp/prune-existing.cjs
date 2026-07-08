const fs = require('fs');
const graph = JSON.parse(fs.readFileSync('C:/barstock/.understand-anything/knowledge-graph.json', 'utf8'));
const changed = fs.readFileSync('C:/barstock/.understand-anything/tmp/changed-files.txt', 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean);
const changedSet = new Set(changed);

const removedIds = new Set();
const keptNodes = graph.nodes.filter(n => {
  if (n.filePath && changedSet.has(n.filePath)) {
    removedIds.add(n.id);
    return false;
  }
  return true;
});
const keptEdges = graph.edges.filter(e => !removedIds.has(e.source) && !removedIds.has(e.target));

fs.writeFileSync('C:/barstock/.understand-anything/intermediate/batch-existing.json', JSON.stringify({ nodes: keptNodes, edges: keptEdges }, null, 2));
console.log(`Removed ${removedIds.size} nodes (matching ${changed.length} changed files). Kept ${keptNodes.length} nodes, ${keptEdges.length} edges.`);
