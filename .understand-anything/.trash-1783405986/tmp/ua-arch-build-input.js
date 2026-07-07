const fs = require('fs');
const dir = 'C:/barstock/.understand-anything/tmp';
const fileNodes = JSON.parse(fs.readFileSync(dir + '/arch-file-nodes.json', 'utf8'));
const importEdges = JSON.parse(fs.readFileSync(dir + '/arch-import-edges.json', 'utf8'));
const allEdges = JSON.parse(fs.readFileSync(dir + '/arch-all-edges.json', 'utf8'));
const out = { fileNodes, importEdges, allEdges };
fs.writeFileSync(dir + '/ua-arch-input.json', JSON.stringify(out));
console.log('fileNodes:', fileNodes.length, 'importEdges:', importEdges.length, 'allEdges:', allEdges.length);
