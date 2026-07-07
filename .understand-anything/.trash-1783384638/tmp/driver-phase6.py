#!/usr/bin/env python
"""Phase 6 — assemble final graph + inline validate.

Fuses assembled-graph.json + layers.json + tour.json into the final
KnowledgeGraph object, then writes the ua-inline-validate.cjs script
and runs it for validation.
"""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:/barstock")
TMP = ROOT / ".understand-anything/tmp"
INTER = ROOT / ".understand-anything/intermediate"
PLUGIN_ROOT = Path(r"C:/Users/amlan/.understand-anything-plugin")


def main():
    assembled = json.loads((INTER / "assembled-graph.json").read_text())
    layers_envelope = json.loads((INTER / "layers.json").read_text())
    tour_envelope = json.loads((INTER / "tour.json").read_text())

    layers = layers_envelope.get("layers", layers_envelope)
    tour = tour_envelope.get("tour", tour_envelope)
    if isinstance(layers, dict):
        layers = layers.get("layers", [])
    if isinstance(tour, dict):
        tour = tour.get("tour", [])

    # Layer normalization: every nodeId must exist in assembled graph.
    node_ids = {n["id"] for n in assembled["nodes"]}
    for layer in layers:
        layer["nodeIds"] = [nid for nid in layer.get("nodeIds", []) if nid in node_ids]

    # Tour normalization: same.
    for step in tour:
        step["nodeIds"] = [nid for nid in step.get("nodeIds", []) if nid in node_ids]

    # Add minimal LLM-quality defaults the merge script didn't provide.
    for n in assembled["nodes"]:
        if "tags" not in n or not n["tags"]:
            n["tags"] = ["untagged"]
        if "summary" not in n or not n.get("summary"):
            n["summary"] = "No summary available."
        if "complexity" not in n:
            n["complexity"] = "moderate"
        if "name" not in n:
            n["name"] = n.get("label") or n["id"].rsplit(":", 1)[-1]
        n.setdefault("name", n["id"])

    # Edge normalization: prefer `type` over `relation` (Skill schema
    # uses `type`; build-batch-N.mjs wrote `relation`).
    fixed_edges = []
    for e in assembled["edges"]:
        if "type" not in e and "relation" in e:
            e = {**e, "type": e["relation"]}
        fixed_edges.append(e)
    assembled["edges"] = fixed_edges

    final = {
        "version": "1.0.0",
        "project": {
            "name": "nexio_stock",
            "languages": ["python"],
            "frameworks": ["fastapi", "sqlalchemy", "alembic", "pydantic", "reportlab"],
            "description": (
                "Barstock (nexio_stock) — single-counter inventory and "
                "billing system for a small liquor shop in Odisha, India. "
                "Backend: FastAPI + SQLAlchemy 2.0 async + Postgres."
            ),
            "analyzedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "gitCommitHash": subprocess.check_output(
                ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
            ).strip(),
        },
        "nodes": assembled["nodes"],
        "edges": assembled["edges"],
        "layers": layers,
        "tour": tour,
    }
    out = INTER / "assembled-graph.json"
    out.write_text(json.dumps(final, indent=2))
    print(
        f"wrote {out.name}: {len(final['nodes'])} nodes, {len(final['edges'])} edges, "
        f"{len(final['layers'])} layers, {len(final['tour'])} tour steps"
    )

    # Write the inline-validator and run it.
    validator = TMP / "ua-inline-validate.cjs"
    validator.write_text(r"""#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);
  const assigned = new Map();
  if (!Array.isArray(graph.layers)) { if (graph.layers) warnings.push('graph.layers is not an array'); graph.layers = []; }
  if (!Array.isArray(graph.tour)) { if (graph.tour) warnings.push('graph.tour is not an array'); graph.tour = []; }
  graph.layers.forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) warnings.push(`File node '${id}' not in any layer`);
  });
  graph.tour.forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
""")

    r = subprocess.run(
        ["node", str(validator), str(out), str(INTER / "review.json")],
        cwd=str(PLUGIN_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if r.returncode != 0:
        print(f"validator FAILED: rc={r.returncode}\nSTDERR:{r.stderr[-500:]}")
        sys.exit(2)
    review = json.loads((INTER / "review.json").read_text())
    print("validator issues:", len(review["issues"]))
    print("validator warnings:", len(review["warnings"]))
    for issue in review["issues"]:
        print(" ISSUE:", issue)
    for w in review["warnings"][:30]:
        print(" WARN:", w)
    print("stats:", json.dumps(review["stats"], indent=2))


if __name__ == "__main__":
    main()
