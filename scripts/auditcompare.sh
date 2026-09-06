#!/usr/bin/env bash
# auditcompare.sh — aggregate rule failures over many seeds so a single sample
# cannot be mistaken for a result. Usage: ./scripts/auditcompare.sh <dir> <secs> [seeds...]
set -u
d=${1:-.}; secs=${2:-180}; shift 2 || true
seeds=${*:-"1 2 3 4 5 6"}
cd "$d" || exit 1
for s in $seeds; do
  npx vite-node scripts/audit-cli.ts "$secs" 3 "$s" 2>&1 | grep -E "^(PASS|FAIL|WARN)"
done | awk '
/^PASS/ { print "TOTAL", $1, $2, $4, $6; next }
/^(FAIL|WARN)/ { id=$2; mult=$4; gsub(/×/,"",mult); tot[id]+=mult; kind[id]=$1; }
END { for (i in tot) printf "%s %s %d\n", kind[i], i, tot[i] | "sort -k3 -rn"; }'
