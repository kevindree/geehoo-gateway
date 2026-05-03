#!/usr/bin/env bash
# PostToolUse hook: runs npm lint after any file edit inside src/
# Receives the tool invocation JSON on stdin.

INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  process.stdin.resume();
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const p = JSON.parse(d);
      const ti = p.toolInput || {};
      console.log(ti.filePath || ti.path || '');
    } catch { console.log(''); }
  });
" 2>/dev/null)

# Only lint when the edited file is under src/
if [[ "$FILE" != */src/* ]]; then
  exit 0
fi

echo "[hook] Running lint after edit to $FILE..."
npm run lint --silent
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "[hook] Lint failed — fix errors before continuing." >&2
  exit 2
fi
