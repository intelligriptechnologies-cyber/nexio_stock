const fs = require('fs');
const path = require('path');

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const fileNodes = data.fileNodes || [];
  const importEdges = data.importEdges || [];
  const allEdges = data.allEdges || [];

  // Only consider file-level edges among allEdges (exclude function/class contains/calls)
  const fileNodeIds = new Set(fileNodes.map(n => n.id));
  const fileLevelAllEdges = allEdges.filter(e => fileNodeIds.has(e.source) && fileNodeIds.has(e.target));

  // A. Directory grouping
  const filePaths = fileNodes.map(n => n.filePath).filter(Boolean);
  function commonPrefix(paths) {
    if (paths.length === 0) return '';
    let prefix = paths[0];
    for (const p of paths.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < p.length && prefix[i] === p[i]) i++;
      prefix = prefix.slice(0, i);
    }
    // trim to last '/'
    const idx = prefix.lastIndexOf('/');
    return idx >= 0 ? prefix.slice(0, idx + 1) : '';
  }
  const prefix = commonPrefix(filePaths);

  function groupForPath(filePath) {
    let rest = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
    const parts = rest.split('/');
    if (parts.length > 1) {
      return parts[0];
    }
    // flat - group by extension pattern
    const name = parts[0];
    if (/\.(test|spec)\./.test(name) || /^test_/.test(name)) return 'test';
    if (/\.config\./.test(name)) return 'config';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'root';
    return ext || 'root';
  }

  const directoryGroups = {};
  const idToGroup = {};
  for (const n of fileNodes) {
    const g = groupForPath(n.filePath);
    idToGroup[n.id] = g;
    if (!directoryGroups[g]) directoryGroups[g] = [];
    directoryGroups[g].push(n.id);
  }

  // B. Node type grouping
  const nodeTypeGroups = {};
  for (const n of fileNodes) {
    if (!nodeTypeGroups[n.type]) nodeTypeGroups[n.type] = [];
    nodeTypeGroups[n.type].push(n.id);
  }

  // C. Import adjacency + fan-in/out
  const fileFanOut = {};
  const fileFanIn = {};
  const adjacency = {};
  for (const n of fileNodes) {
    fileFanOut[n.id] = 0;
    fileFanIn[n.id] = 0;
    adjacency[n.id] = new Set();
  }
  for (const e of importEdges) {
    if (!fileNodeIds.has(e.source) || !fileNodeIds.has(e.target)) continue;
    fileFanOut[e.source] = (fileFanOut[e.source] || 0) + 1;
    fileFanIn[e.target] = (fileFanIn[e.target] || 0) + 1;
    adjacency[e.source].add(e.target);
  }

  // D. Cross-category dependency analysis
  const crossCategoryMap = {};
  for (const e of allEdges) {
    const srcNode = fileNodes.find(n => n.id === e.source);
    const tgtNode = fileNodes.find(n => n.id === e.target);
    if (!srcNode || !tgtNode) continue;
    if (srcNode.type === tgtNode.type) continue;
    const key = `${srcNode.type}|${tgtNode.type}|${e.type}`;
    if (!crossCategoryMap[key]) crossCategoryMap[key] = 0;
    crossCategoryMap[key]++;
  }
  const crossCategoryEdges = Object.entries(crossCategoryMap).map(([key, count]) => {
    const [fromType, toType, edgeType] = key.split('|');
    return { fromType, toType, edgeType, count };
  });

  // E. Inter-group import frequency
  const interGroupMap = {};
  for (const e of importEdges) {
    if (!fileNodeIds.has(e.source) || !fileNodeIds.has(e.target)) continue;
    const gFrom = idToGroup[e.source];
    const gTo = idToGroup[e.target];
    if (gFrom === gTo) continue;
    const key = `${gFrom}|${gTo}`;
    if (!interGroupMap[key]) interGroupMap[key] = 0;
    interGroupMap[key]++;
  }
  const interGroupImports = Object.entries(interGroupMap).map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  });

  // F. Intra-group import density
  const intraGroupDensity = {};
  for (const g of Object.keys(directoryGroups)) {
    let internal = 0;
    let total = 0;
    for (const e of importEdges) {
      if (!fileNodeIds.has(e.source) || !fileNodeIds.has(e.target)) continue;
      const gFrom = idToGroup[e.source];
      const gTo = idToGroup[e.target];
      if (gFrom !== g && gTo !== g) continue;
      total++;
      if (gFrom === g && gTo === g) internal++;
    }
    intraGroupDensity[g] = { internalEdges: internal, totalEdges: total, density: total > 0 ? +(internal / total).toFixed(3) : 0 };
  }

  // G. Directory pattern matching
  const patternDict = {
    routes: 'api', api: 'api', controllers: 'api', endpoints: 'api', handlers: 'api',
    services: 'service', core: 'service', lib: 'service', domain: 'service', logic: 'service',
    models: 'data', db: 'data', data: 'data', persistence: 'data', repository: 'data', entities: 'data',
    components: 'ui', views: 'ui', pages: 'ui', ui: 'ui', layouts: 'ui', screens: 'ui',
    middleware: 'middleware', plugins: 'middleware', interceptors: 'middleware', guards: 'middleware',
    utils: 'utility', helpers: 'utility', common: 'utility', shared: 'utility', tools: 'utility',
    config: 'config', constants: 'config', env: 'config', settings: 'config',
    __tests__: 'test', test: 'test', tests: 'test', spec: 'test', specs: 'test', e2e: 'test',
    types: 'types', interfaces: 'types', schemas: 'types', contracts: 'types', dtos: 'types',
    hooks: 'hooks',
    store: 'state', state: 'state', reducers: 'state', actions: 'state', slices: 'state',
    assets: 'assets', static: 'assets', public: 'assets',
    migrations: 'data',
    management: 'config', commands: 'config',
    templatetags: 'utility',
    signals: 'service',
    serializers: 'api',
    cmd: 'entry',
    internal: 'service',
    pkg: 'utility',
    dto: 'types', request: 'types', response: 'types',
    entity: 'data',
    controller: 'api',
    routers: 'api',
    composables: 'service',
    blueprints: 'api',
    mailers: 'service', jobs: 'service', channels: 'service',
    bin: 'entry',
    docs: 'documentation', documentation: 'documentation', wiki: 'documentation',
    deploy: 'infrastructure', deployment: 'infrastructure', infra: 'infrastructure', infrastructure: 'infrastructure',
    k8s: 'infrastructure', kubernetes: 'infrastructure', helm: 'infrastructure', charts: 'infrastructure',
    terraform: 'infrastructure', tf: 'infrastructure',
    docker: 'infrastructure',
    sql: 'data', database: 'data', schema: 'data',
    auth: 'service',
    theme: 'ui',
  };
  const patternMatches = {};
  for (const g of Object.keys(directoryGroups)) {
    if (patternDict[g]) patternMatches[g] = patternDict[g];
  }

  // H. Deployment topology detection
  const allFileNames = fileNodes.map(n => n.filePath);
  const hasDockerfile = allFileNames.some(p => /Dockerfile/i.test(p));
  const hasCompose = allFileNames.some(p => /docker-compose/i.test(p));
  const hasK8s = allFileNames.some(p => /(^|\/)(k8s|kubernetes|helm|charts)(\/|$)/i.test(p));
  const hasTerraform = allFileNames.some(p => /\.tf(vars)?$/i.test(p));
  const hasCI = allFileNames.some(p => /\.github\/workflows|\.gitlab-ci\.yml|Jenkinsfile/i.test(p));
  const infraFiles = allFileNames.filter(p => /Dockerfile|docker-compose|\.tf(vars)?$|\.github\/workflows|\.gitlab-ci\.yml|Jenkinsfile|k8s|kubernetes|helm/i.test(p));

  const deploymentTopology = {
    hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI, infraFiles
  };

  // I. Data pipeline detection
  const schemaFiles = allFileNames.filter(p => /\.sql$|\.graphql$|\.gql$|\.proto$|\.prisma$/i.test(p));
  const migrationFiles = allFileNames.filter(p => /migrations\//i.test(p));
  const dataModelFiles = fileNodes.filter(n => /models|entities|data-model/i.test(n.filePath) || (n.tags || []).includes('data-model')).map(n => n.filePath);
  const apiHandlerFiles = fileNodes.filter(n => (n.tags || []).includes('api-handler') || (n.tags || []).includes('api-client')).map(n => n.filePath);

  const dataPipeline = { schemaFiles, migrationFiles, dataModelFiles, apiHandlerFiles };

  // J. Documentation coverage
  const docFiles = fileNodes.filter(n => n.type === 'document' || /\.md$|\.rst$/i.test(n.filePath));
  const totalGroups = Object.keys(directoryGroups).length;
  // naive: check if any doc file path references group name, or README present at root
  const groupsWithDocsSet = new Set();
  for (const g of Object.keys(directoryGroups)) {
    for (const d of docFiles) {
      if (d.filePath.toLowerCase().includes(g.toLowerCase())) groupsWithDocsSet.add(g);
    }
  }
  const groupsWithDocs = groupsWithDocsSet.size;
  const undocumentedGroups = Object.keys(directoryGroups).filter(g => !groupsWithDocsSet.has(g));
  const docCoverage = {
    groupsWithDocs,
    totalGroups,
    coverageRatio: totalGroups > 0 ? +(groupsWithDocs / totalGroups).toFixed(2) : 0,
    undocumentedGroups
  };

  // K. Dependency direction
  const dependencyDirection = [];
  const seenPairs = new Set();
  for (const g1 of Object.keys(directoryGroups)) {
    for (const g2 of Object.keys(directoryGroups)) {
      if (g1 === g2) continue;
      const pairKey = [g1, g2].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const forward = interGroupMap[`${g1}|${g2}`] || 0;
      const backward = interGroupMap[`${g2}|${g1}`] || 0;
      if (forward === 0 && backward === 0) continue;
      if (forward > backward) dependencyDirection.push({ dependent: g1, dependsOn: g2 });
      else if (backward > forward) dependencyDirection.push({ dependent: g2, dependsOn: g1 });
    }
  }

  // fileStats
  const filesPerGroup = {};
  for (const g of Object.keys(directoryGroups)) filesPerGroup[g] = directoryGroups[g].length;
  const nodeTypeCounts = {};
  for (const t of Object.keys(nodeTypeGroups)) nodeTypeCounts[t] = nodeTypeGroups[t].length;

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
    fileStats: {
      totalFileNodes: fileNodes.length,
      filesPerGroup,
      nodeTypeCounts
    },
    fileFanIn,
    fileFanOut,
    commonPrefix: prefix
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log('Analysis complete. Written to', outputPath);
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error('Fatal error:', err && err.stack || err);
  process.exit(1);
}
