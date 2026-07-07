const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) fail('Usage: node ua-arch-analyze.js <input.json> <output.json>');

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (e) {
  fail('Failed to read/parse input: ' + e.message);
}

const fileNodes = data.fileNodes || [];
const importEdges = data.importEdges || [];
const allEdges = data.allEdges || [];

// --- A. Directory Grouping ---
function commonPrefix(paths) {
  if (paths.length === 0) return '';
  let parts = paths.map(p => p.split('/'));
  let prefix = [];
  for (let i = 0; i < parts[0].length - 1; i++) {
    const seg = parts[0][i];
    if (parts.every(p => p[i] === seg)) prefix.push(seg);
    else break;
  }
  return prefix.length ? prefix.join('/') + '/' : '';
}

const allPaths = fileNodes.map(n => n.filePath).filter(Boolean);
const prefix = commonPrefix(allPaths);

function groupOf(node) {
  const fp = node.filePath || '';
  let rest = fp.startsWith(prefix) ? fp.slice(prefix.length) : fp;
  const segs = rest.split('/');
  if (segs.length > 1) {
    return segs[0];
  }
  // flat structure - group by file type/extension pattern
  const name = segs[0] || node.name || '';
  if (/\.(test|spec)\.\w+$/.test(name) || /^test_/.test(name) || /_test\.\w+$/.test(name)) return 'test';
  if (/\.config\./.test(name) || /config/i.test(name)) return 'config';
  const extMatch = name.match(/\.([a-zA-Z0-9]+)$/);
  return extMatch ? extMatch[1] : 'root';
}

const directoryGroups = {};
for (const node of fileNodes) {
  const g = groupOf(node);
  if (!directoryGroups[g]) directoryGroups[g] = [];
  directoryGroups[g].push(node.id);
}

// --- B. Node Type Grouping ---
const nodeTypeGroups = {};
for (const node of fileNodes) {
  const t = node.type || 'file';
  if (!nodeTypeGroups[t]) nodeTypeGroups[t] = [];
  nodeTypeGroups[t].push(node.id);
}

// --- C. Import Adjacency Matrix ---
const fileFanOut = {};
const fileFanIn = {};
const adjacency = {};
for (const edge of importEdges) {
  if (!adjacency[edge.source]) adjacency[edge.source] = new Set();
  adjacency[edge.source].add(edge.target);
  fileFanOut[edge.source] = (fileFanOut[edge.source] || 0) + 1;
  fileFanIn[edge.target] = (fileFanIn[edge.target] || 0) + 1;
}

const idToGroup = {};
for (const [g, ids] of Object.entries(directoryGroups)) {
  for (const id of ids) idToGroup[id] = g;
}

const groupImportsFrom = {}; // group -> set of groups it imports from
const groupImportedBy = {}; // group -> set of groups that import it
for (const edge of importEdges) {
  const sg = idToGroup[edge.source];
  const tg = idToGroup[edge.target];
  if (!sg || !tg) continue;
  if (!groupImportsFrom[sg]) groupImportsFrom[sg] = new Set();
  groupImportsFrom[sg].add(tg);
  if (!groupImportedBy[tg]) groupImportedBy[tg] = new Set();
  groupImportedBy[tg].add(sg);
}

// --- D. Cross-Category Dependency Analysis ---
function typeOf(id) {
  const node = fileNodes.find(n => n.id === id);
  if (node) return node.type;
  // fallback: parse prefix before ':'
  const idx = id.indexOf(':');
  return idx > -1 ? id.slice(0, idx) : 'unknown';
}

const nodeIdSet = new Set(fileNodes.map(n => n.id));
const crossCategoryMap = {};
for (const edge of allEdges) {
  if (edge.type === 'imports') continue; // handled separately, but could still cross category; include only non-file-file trivial dup
  if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
  const fromType = typeOf(edge.source);
  const toType = typeOf(edge.target);
  if (fromType === toType && fromType === 'file') continue; // skip file-file duplicate of import-like within same category unless different edge type
  const key = fromType + '||' + toType + '||' + edge.type;
  crossCategoryMap[key] = (crossCategoryMap[key] || 0) + 1;
}
const crossCategoryEdges = Object.entries(crossCategoryMap).map(([key, count]) => {
  const [fromType, toType, edgeType] = key.split('||');
  return { fromType, toType, edgeType, count };
});

// --- E. Inter-Group Import Frequency ---
const interGroupMap = {};
for (const edge of importEdges) {
  const sg = idToGroup[edge.source];
  const tg = idToGroup[edge.target];
  if (!sg || !tg || sg === tg) continue;
  const key = sg + '||' + tg;
  interGroupMap[key] = (interGroupMap[key] || 0) + 1;
}
const interGroupImports = Object.entries(interGroupMap).map(([key, count]) => {
  const [from, to] = key.split('||');
  return { from, to, count };
});

// --- F. Intra-Group Import Density ---
const intraGroupDensity = {};
for (const g of Object.keys(directoryGroups)) {
  let internal = 0;
  let total = 0;
  for (const edge of importEdges) {
    const sg = idToGroup[edge.source];
    const tg = idToGroup[edge.target];
    if (sg === g || tg === g) {
      total++;
      if (sg === g && tg === g) internal++;
    }
  }
  intraGroupDensity[g] = { internalEdges: internal, totalEdges: total, density: total > 0 ? +(internal / total).toFixed(3) : 0 };
}

// --- G. Directory Pattern Matching ---
const patternTable = [
  { pats: ['routes', 'api', 'controllers', 'endpoints', 'handlers'], label: 'api' },
  { pats: ['services', 'core', 'lib', 'domain', 'logic'], label: 'service' },
  { pats: ['models', 'db', 'data', 'persistence', 'repository', 'entities'], label: 'data' },
  { pats: ['components', 'views', 'pages', 'ui', 'layouts', 'screens'], label: 'ui' },
  { pats: ['middleware', 'plugins', 'interceptors', 'guards'], label: 'middleware' },
  { pats: ['utils', 'helpers', 'common', 'shared', 'tools'], label: 'utility' },
  { pats: ['config', 'constants', 'env', 'settings'], label: 'config' },
  { pats: ['__tests__', 'test', 'tests', 'spec', 'specs'], label: 'test' },
  { pats: ['types', 'interfaces', 'schemas', 'contracts', 'dtos'], label: 'types' },
  { pats: ['hooks'], label: 'hooks' },
  { pats: ['store', 'state', 'reducers', 'actions', 'slices'], label: 'state' },
  { pats: ['assets', 'static', 'public'], label: 'assets' },
  { pats: ['migrations'], label: 'data' },
  { pats: ['management', 'commands'], label: 'config' },
  { pats: ['templatetags'], label: 'utility' },
  { pats: ['signals'], label: 'service' },
  { pats: ['serializers'], label: 'api' },
  { pats: ['cmd'], label: 'entry' },
  { pats: ['internal'], label: 'service' },
  { pats: ['pkg'], label: 'utility' },
  { pats: ['dto', 'request', 'response'], label: 'types' },
  { pats: ['entity'], label: 'data' },
  { pats: ['controller'], label: 'api' },
  { pats: ['routers'], label: 'api' },
  { pats: ['composables'], label: 'service' },
  { pats: ['blueprints'], label: 'api' },
  { pats: ['mailers', 'jobs', 'channels'], label: 'service' },
  { pats: ['bin'], label: 'entry' },
  { pats: ['docs', 'documentation', 'wiki'], label: 'documentation' },
  { pats: ['deploy', 'deployment', 'infra', 'infrastructure'], label: 'infrastructure' },
  { pats: ['.github', '.gitlab', '.circleci'], label: 'ci-cd' },
  { pats: ['k8s', 'kubernetes', 'helm', 'charts'], label: 'infrastructure' },
  { pats: ['terraform', 'tf'], label: 'infrastructure' },
  { pats: ['docker'], label: 'infrastructure' },
  { pats: ['sql', 'database', 'schema'], label: 'data' },
  { pats: ['alembic'], label: 'data' },
  { pats: ['harness'], label: 'documentation' },
];

function matchPattern(dirName) {
  const lower = dirName.toLowerCase();
  for (const { pats, label } of patternTable) {
    if (pats.includes(lower)) return label;
  }
  return null;
}

const patternMatches = {};
for (const g of Object.keys(directoryGroups)) {
  const m = matchPattern(g);
  if (m) patternMatches[g] = m;
}

// --- H. Deployment Topology Detection ---
const infraFiles = [];
let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;
for (const node of fileNodes) {
  const fp = (node.filePath || '').toLowerCase();
  const name = (node.name || '').toLowerCase();
  if (name === 'dockerfile' || fp.includes('dockerfile')) { hasDockerfile = true; infraFiles.push(node.filePath); }
  if (name.startsWith('docker-compose')) { hasCompose = true; infraFiles.push(node.filePath); }
  if (fp.includes('k8s') || fp.includes('kubernetes') || fp.includes('helm')) { hasK8s = true; infraFiles.push(node.filePath); }
  if (fp.endsWith('.tf') || fp.endsWith('.tfvars')) { hasTerraform = true; infraFiles.push(node.filePath); }
  if (fp.includes('.github/workflows') || name === '.gitlab-ci.yml' || name === 'jenkinsfile') { hasCI = true; infraFiles.push(node.filePath); }
}

const deploymentTopology = {
  hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI,
  infraFiles: [...new Set(infraFiles)],
};

// --- I. Data Pipeline Detection ---
const schemaFiles = [];
const migrationFiles = [];
const dataModelFiles = [];
const apiHandlerFiles = [];
for (const node of fileNodes) {
  const fp = node.filePath || '';
  const tags = node.tags || [];
  if (/\.sql$/.test(fp) || /\.graphql$/.test(fp) || /\.proto$/.test(fp) || tags.includes('schema')) schemaFiles.push(fp);
  if (fp.includes('migrations') || fp.includes('alembic/versions')) migrationFiles.push(fp);
  if (fp.includes('/models/') || tags.includes('data-model')) dataModelFiles.push(fp);
  if (fp.includes('/api/') || tags.includes('api-handler')) apiHandlerFiles.push(fp);
}

const dataPipeline = { schemaFiles, migrationFiles, dataModelFiles, apiHandlerFiles };

// --- J. Documentation Coverage ---
const docFiles = fileNodes.filter(n => n.type === 'document' || /\.md$/i.test(n.filePath || '') || /\.rst$/i.test(n.filePath || ''));
let groupsWithDocs = 0;
const undocumentedGroups = [];
for (const g of Object.keys(directoryGroups)) {
  const hasDoc = docFiles.some(d => (d.filePath || '').startsWith(g + '/') || idToGroup[d.id] === g);
  if (hasDoc) groupsWithDocs++;
  else undocumentedGroups.push(g);
}
const totalGroups = Object.keys(directoryGroups).length;
const docCoverage = {
  groupsWithDocs,
  totalGroups,
  coverageRatio: totalGroups > 0 ? +(groupsWithDocs / totalGroups).toFixed(2) : 0,
  undocumentedGroups,
};

// --- K. Dependency Direction ---
const dependencyDirection = [];
const seenPairs = new Set();
for (const { from, to, count } of interGroupImports) {
  const reverseKey = to + '||' + from;
  const forwardKey = from + '||' + to;
  if (seenPairs.has(forwardKey) || seenPairs.has(reverseKey)) continue;
  const reverseCount = interGroupMap[reverseKey] || 0;
  if (count > reverseCount) {
    dependencyDirection.push({ dependent: from, dependsOn: to });
  } else if (reverseCount > count) {
    dependencyDirection.push({ dependent: to, dependsOn: from });
  }
  seenPairs.add(forwardKey);
  seenPairs.add(reverseKey);
}

// --- fileStats ---
const filesPerGroup = {};
for (const [g, ids] of Object.entries(directoryGroups)) filesPerGroup[g] = ids.length;
const nodeTypeCounts = {};
for (const [t, ids] of Object.entries(nodeTypeGroups)) nodeTypeCounts[t] = ids.length;

const fileStats = {
  totalFileNodes: fileNodes.length,
  filesPerGroup,
  nodeTypeCounts,
};

const result = {
  scriptCompleted: true,
  directoryGroups,
  nodeTypeGroups,
  crossCategoryEdges,
  interGroupImports,
  intraGroupDensity,
  patternMatches,
  deploymentTopology,
  dataPipeline,
  docCoverage,
  dependencyDirection,
  fileStats,
  fileFanIn,
  fileFanOut,
};

try {
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
} catch (e) {
  fail('Failed to write output: ' + e.message);
}

process.exit(0);
