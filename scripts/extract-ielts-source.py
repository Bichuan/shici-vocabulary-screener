"""Extract the fixed IELTS subset from the upstream ECDICT CSV."""

import argparse
import csv
import hashlib
import json
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("csv_file", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
expected = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf"
if hashlib.sha256(args.csv_file.read_bytes()).hexdigest() != expected:
    raise SystemExit("The ECDICT CSV does not match the pinned source.")

with args.csv_file.open(encoding="utf-8-sig", newline="") as source:
    rows = [
        [row["word"], row["translation"], int(row["bnc"]), int(row["frq"]), row["exchange"]]
        for row in csv.DictReader(source)
        if "ielts" in row["tag"].split()
    ]

if len(rows) != 5040:
    raise SystemExit(f"Expected 5040 tagged rows, got {len(rows)}.")
encoded = ",\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_bytes(f"[\n{encoded}\n]\n".encode("utf-8"))
