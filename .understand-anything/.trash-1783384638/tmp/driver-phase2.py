#!/usr/bin/env python
"""Run Phase 2 inline fallback for every batch in batches.json.

This writes per-batch input, invokes extract-structure.mjs, then runs
build-batch-N.mjs and verify-batch-N.mjs. Stops on the first failure.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"C:/barstock")
TMP = ROOT / ".understand-anything/tmp"
INTER = ROOT / ".understand-anything/intermediate"
PLUGIN_ROOT = Path(r"C:/Users/amlan/.understand-anything-plugin")
EXTRACT_SCRIPT = PLUGIN_ROOT / "skills/understand/extract-structure.mjs"
BUILD_SCRIPT = TMP / "build-batch-N.mjs"
VERIFY_SCRIPT = TMP / "verify-batch-N.mjs"


def main():
    batches = json.loads((INTER / "batches.json").read_text())["batches"]
    print(f"Found {len(batches)} batches.", flush=True)
    for batch in batches:
        bidx = batch["batchIndex"]
        files = batch["files"]
        imports = batch.get("batchImportData", {})
        # Write the extract-structure input: {projectRoot, batchFiles, batchImportData}
        extract_input = {
            "projectRoot": str(ROOT),
            "batchFiles": files,
            "batchImportData": imports,
        }
        extract_input_path = TMP / f"ua-file-analyzer-input-{bidx}.json"
        extract_input_path.write_text(json.dumps(extract_input))
        extract_results_path = TMP / f"ua-file-extract-results-{bidx}.json"

        # Step 1: extract-structure
        r = subprocess.run(
            [
                "node",
                str(EXTRACT_SCRIPT),
                str(extract_input_path),
                str(extract_results_path),
            ],
            cwd=str(PLUGIN_ROOT),
            capture_output=True,
            text=True,
            timeout=120,
        )
        # Exit code 0 is good; some extractors write warnings to stderr.
        if r.returncode != 0:
            print(f"batch {bidx} extract FAILED: {r.stderr[-500:]}", flush=True)
            sys.exit(2)
        extract_out = json.loads(extract_results_path.read_text())
        if extract_out.get("scriptCompleted") is not True:
            print(
                f"batch {bidx} extract: scriptCompleted=False. metrics={extract_out.get('metrics', {})}",
                flush=True,
            )
        print(
            f"batch {bidx} extract: filesAnalyzed={extract_out.get('filesAnalyzed')} of {len(files)}",
            flush=True,
        )

        # Step 2: build the batch graph
        r = subprocess.run(
            ["node", str(BUILD_SCRIPT), str(ROOT), str(bidx)],
            cwd=str(PLUGIN_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if r.returncode not in (0, 2):
            print(f"batch {bidx} build FAILED: rc={r.returncode}\n{r.stderr[-500:]}", flush=True)
            sys.exit(3)
        print(f"batch {bidx} build: {r.stdout.strip()}", flush=True)

        # Step 3: verify
        r = subprocess.run(
            ["node", str(VERIFY_SCRIPT), str(ROOT), str(bidx)],
            cwd=str(PLUGIN_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if r.returncode != 0:
            print(f"batch {bidx} verify FAILED:\n{r.stdout[-800:]}\nSTDERR:{r.stderr[-400:]}", flush=True)
            sys.exit(4)
        # Show last line of verify output (the summary)
        last = [ln for ln in r.stdout.splitlines() if ln.strip()][-1] if r.stdout.strip() else ""
        print(f"batch {bidx} verify: {last}", flush=True)


if __name__ == "__main__":
    main()
