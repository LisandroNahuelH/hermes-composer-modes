#!/usr/bin/env bash
# composer-modes is Windows-only for v1. This stub exists so macOS/Linux agents
# stop HERE with a clear message and a non-zero exit, instead of improvising a
# hand-patched core. See README.md -> Platform support.
set -u
cat >&2 <<'EOF'
composer-modes: Windows-only release (v1).
No macOS/Linux installer ships today (deliberate: the patch flow is verified on
Windows only). Do not hand-patch the core. Watch the repo for a v2 port, or use
the upstream PR as the alternative path: README.md -> Alternative: upstream PR.
EOF
exit 1
