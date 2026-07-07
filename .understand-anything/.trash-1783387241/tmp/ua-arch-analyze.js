const fs = require('fs');

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const { fileNodes, importEdges, allEdges } = data;

  const idToNode = {};
  for (const n of fileNodes) idToNode[n.id] = n;

  // A. Directory grouping
  const paths = fileNodes.map(n => n.filePath.replace(/\\/g, '/'));
  function commonPrefix(strs) {
    if (strs.length === 0) return '';
    let prefix = strs[0];
    for (const s of strs.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
      prefix = prefix.slice(0, i);
    }
    // trim to last '/'
    const idx = prefix.lastIndexOf('/');
    return idx >= 0 ? prefix.slice(0, idx + 1) : '';
  }
  const prefix = commonPrefix(paths);

  function groupFor(filePath) {
    let rest = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
    const parts = rest.split('/');
    if (parts.length > 1) {
      return parts[0];
    }
    // flat file directly under prefix root - group by extension/pattern
    const fname = parts[0];
    if (/\.test\.|\.spec\.|^test_|_test\.go$|Test\.java$|_spec\.rb$|Test\.php$|Tests\.cs$/.test(fname)) return 'test';
    if (/\.config\./.test(fname)) return 'config';
    const dotIdx = fname.lastIndexOf('.');
    const ext = dotIdx >= 0 ? fname.slice(dotIdx + 1) : 'noext';
    return `root(${ext})`;
  }

  const directoryGroups = {};
  const fileToGroup = {};
  for (const n of fileNodes) {
    const fp = n.filePath.replace(/\\/g, '/');
    const g = groupFor(fp);
    fileToGroup[n.id] = g;
    if (!directoryGroups[g]) directoryGroups[g] = [];
    directoryGroups[g].push(n.id);
  }

  // B. Node type grouping
  const nodeTypeGroups = {};
  for (const n of fileNodes) {
    if (!nodeTypeGroups[n.type]) nodeTypeGroups[n.type] = [];
    nodeTypeGroups[n.type].push(n.id);
  }

  // C. Import adjacency / fan-in fan-out
  const fanOut = {};
  const fanIn = {};
  const groupImportsFrom = {}; // group -> set of groups it imports from
  const groupImportedBy = {}; // group -> set of groups that import it
  for (const e of importEdges) {
    fanOut[e.source] = (fanOut[e.source] || 0) + 1;
    fanIn[e.target] = (fanIn[e.target] || 0) + 1;
  }

  // E. Inter-group import frequency
  const interGroupMap = {};
  for (const e of importEdges) {
    const gs = fileToGroup[e.source];
    const gt = fileToGroup[e.target];
    if (!gs || !gt) continue;
    const key = `${gs}=>${gt}`;
    interGroupMap[key] = (interGroupMap[key] || 0) + 1;
  }
  const interGroupImports = Object.entries(interGroupMap).map(([k, count]) => {
    const [from, to] = k.split('=>');
    return { from, to, count };
  });

  // F. Intra-group density
  const intraGroupDensity = {};
  for (const g of Object.keys(directoryGroups)) {
    let internalEdges = 0;
    let totalEdges = 0;
    for (const e of importEdges) {
      const gs = fileToGroup[e.source];
      const gt = fileToGroup[e.target];
      if (gs === g || gt === g) {
        totalEdges++;
        if (gs === g && gt === g) internalEdges++;
      }
    }
    intraGroupDensity[g] = {
      internalEdges,
      totalEdges,
      density: totalEdges > 0 ? internalEdges / totalEdges : 0
    };
  }

  // D. Cross category edges (using allEdges, excluding pure import-type file-file edges captured above already counted separately)
  const crossCategoryMap = {};
  for (const e of allEdges) {
    const sn = idToNode[e.source];
    const tn = idToNode[e.target];
    if (!sn || !tn) continue;
    if (sn.type === tn.type) continue; // only cross-category
    const key = `${sn.type}=>${tn.type}=>${e.type}`;
    crossCategoryMap[key] = (crossCategoryMap[key] || 0) + 1;
  }
  const crossCategoryEdges = Object.entries(crossCategoryMap).map(([k, count]) => {
    const [fromType, toType, edgeType] = k.split('=>');
    return { fromType, toType, edgeType, count };
  });

  // G. Pattern matching
  const dirPatterns = {
    routes: 'api', api: 'api', controllers: 'api', endpoints: 'api', handlers: 'api',
    services: 'service', core: 'service', lib: 'service', domain: 'service', logic: 'service',
    models: 'data', db: 'data', data: 'data', persistence: 'data', repository: 'data', entities: 'data',
    components: 'ui', views: 'ui', pages: 'ui', ui: 'ui', layouts: 'ui', screens: 'ui',
    middleware: 'middleware', plugins: 'middleware', interceptors: 'middleware', guards: 'middleware',
    utils: 'utility', helpers: 'utility', common: 'utility', shared: 'utility', tools: 'utility',
    config: 'config', constants: 'config', env: 'config', settings: 'config',
    __tests__: 'test', test: 'test', tests: 'test', spec: 'test', specs: 'test',
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
    security: 'middleware',
    alembic: 'data',
    harness: 'documentation'
  };
  const patternMatches = {};
  for (const g of Object.keys(directoryGroups)) {
    if (dirPatterns[g]) {
      patternMatches[g] = dirPatterns[g];
    }
  }

  // H. Deployment topology
  const infraFiles = [];
  let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;
  for (const n of fileNodes) {
    const fp = n.filePath.replace(/\\/g, '/');
    const base = fp.split('/').pop();
    if (/^Dockerfile/.test(base)) { hasDockerfile = true; infraFiles.push(fp); }
    if (/docker-compose/.test(base)) { hasCompose = true; infraFiles.push(fp); }
    if (/\.tf$|\.tfvars$/.test(base)) { hasTerraform = true; infraFiles.push(fp); }
    if (/^k8s\//.test(fp) || /kubernetes/.test(fp) || /helm/.test(fp)) { hasK8s = true; infraFiles.push(fp); }
    if (/^\.github\/workflows\//.test(fp) || /\.gitlab-ci\.yml$/.test(base) || /Jenkinsfile$/.test(base)) { hasCI = true; infraFiles.push(fp); }
  }

  // I. Data pipeline detection
  const schemaFiles = [];
  const migrationFiles = [];
  const dataModelFiles = [];
  const apiHandlerFiles = [];
  for (const n of fileNodes) {
    const fp = n.filePath.replace(/\\/g, '/');
    if (/\.sql$/.test(fp) || /schema\.graphql$/.test(fp) || /\.proto$/.test(fp)) schemaFiles.push(fp);
    if (/migrations?\//.test(fp) || /alembic\/versions\//.test(fp)) migrationFiles.push(fp);
    if (/models?\//.test(fp) || /\/models\.py$/.test(fp)) dataModelFiles.push(fp);
    if (/routers?\//.test(fp) || /\/api\//.test(fp) || /routes?\//.test(fp)) apiHandlerFiles.push(fp);
  }

  // J. Doc coverage
  const docFiles = fileNodes.filter(n => n.type === 'document' || /\.md$/.test(n.filePath));
  let groupsWithDocs = 0;
  const undocumentedGroups = [];
  for (const g of Object.keys(directoryGroups)) {
    const hasReadme = directoryGroups[g].some(id => /README/i.test(idToNode[id].name));
    if (hasReadme) groupsWithDocs++;
    else undocumentedGroups.push(g);
  }
  const totalGroups = Object.keys(directoryGroups).length;

  // K. Dependency direction
  const dependencyDirection = [];
  const seenPairs = new Set();
  for (const { from, to, count } of interGroupImports) {
    if (from === to) continue;
    const pairKey = [from, to].sort().join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const reverse = interGroupImports.find(e => e.from === to && e.to === from);
    const reverseCount = reverse ? reverse.count : 0;
    if (count > reverseCount) {
      dependencyDirection.push({ dependent: from, dependsOn: to });
    } else if (reverseCount > count) {
      dependencyDirection.push({ dependent: to, dependsOn: from });
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
    deploymentTopology: {
      hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI,
      infraFiles: [...new Set(infraFiles)]
    },
    dataPipeline: {
      schemaFiles, migrationFiles, dataModelFiles, apiHandlerFiles
    },
    docCoverage: {
      groupsWithDocs,
      totalGroups,
      coverageRatio: totalGroups > 0 ? groupsWithDocs / totalGroups : 0,
      undocumentedGroups
    },
    dependencyDirection,
    fileStats: {
      totalFileNodes: fileNodes.length,
      filesPerGroup,
      nodeTypeCounts
    },
    fileFanIn: fanIn,
    fileFanOut: fanOut,
    commonPrefix: prefix
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log('Analysis complete. Output written to', outputPath);
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
