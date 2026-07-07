#!/usr/bin/env python
"""Phase 7 — save final graph + fingerprints + meta.json.

Mirrors the Skill's Phase 7 procedure exactly:
  1. Write knowledge-graph.json
  2. Build fingerprints baseline (must succeed before meta.json)
  3. Write meta.json
  4. Cleanup: move scratch dirs to .trash-<ts>, preserve scan-result.json
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"C:/barstock")
UNDERSTAND = ROOT / ".understand-anything"
INTER = UNDERSTAND / "intermediate"
TMP = UNDERSTAND / "tmp"
PLUGIN_ROOT = Path(r"C:/Users/amlan/.understand-anything-plugin")


def main():
    graph_path = UNDERSTAND / "knowledge-graph.json"
    graph = json.loads((INTER / "assembled-graph.json").read_text())
    graph_path.write_text(json.dumps(graph, indent=2))
    print(f"wrote {graph_path.name}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")

    # Build fingerprint baseline.
    src_paths = [n["path"] for n in graph["nodes"] if n.get("type") == "file" and n.get("path")]
    fp_input = INTER / "fingerprint-input.json"
    commit = subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
    ).strip()
    fp_input.write_text(json.dumps(
        {"projectRoot": str(ROOT), "sourceFilePaths": src_paths, "gitCommitHash": commit},
        indent=2,
    ))

    r = subprocess.run(
        ["node", str(PLUGIN_ROOT / "skills/understand/build-fingerprints.mjs"), str(fp_input)],
        cwd=str(PLUGIN_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    print(f"build-fingerprints: rc={r.returncode}")
    if r.returncode != 0 or "Fingerprints baseline:" not in r.stdout:
        print("STDOUT:", r.stdout[-1000:])
        print("STDERR:", r.stderr[-1000:])
        sys.exit(2)
    print("fingerprint stdout tail:", [ln for ln in r.stdout.splitlines() if "baseline" in ln.lower()][-1])

    # Write meta.json only after fingerprints succeed.
    meta = {
        "lastAnalyzedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gitCommitHash": commit,
        "version": "1.0.0",
        "analyzedFiles": sum(1 for n in graph["nodes"] if n.get("type") == "file"),
    }
    (UNDERSTAND / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"wrote meta.json: {meta['analyzedFiles']} files at {commit[:7]}")

    # Cleanup: trash scratch dirs, preserve scan-result.json for incremental reuse.
    trash = UNDERSTAND / f".trash-{int(time.time())}"
    trash.mkdir(exist_ok=True)
    moved = 0
    if INTER.exists():
        for entry in INTER.iterdir():
            if entry.name == "scan-result.json":
                continue
            try:
                shutil.move(str(entry), str(trash / entry.name))
                moved += 1
            except Exception as e:
                print(f"  ! couldn't move {entry}: {e}")
    if TMP.exists():
        try:
            shutil.move(str(TMP), str(trash / "tmp"))
        except Exception as e:
            print(f"  ! couldn't move tmp: {e}")

    print(f"cleanup: moved {moved} entry(ies) into {trash.name}/")

    # Phase 7 final report.
    print()
    print("=== Phase 7 final report ===")
    print(f"Project: nexio_stock (Barstock)")
    print(f"Files analyzed: {meta['analyzedFiles']} of 79")
    print(f"Nodes: {len(graph['nodes'])} (file=79, function=167, class=16)")
    print(f"Edges: {len(graph['edges'])} (imports=205, contains=183)")
    print(f"Layers: {len(graph['layers'])}")
    print(f"Tour steps: {len(graph['tour'])}")
    print(f"Output: {graph_path}")


if __name__ == "__main__":
    main()
