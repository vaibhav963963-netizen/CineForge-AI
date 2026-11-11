#!/bin/bash
# Studio self-test (workspace only; nothing outside this folder is touched):
#   1. unit tests: config validation, progress math, storyboard planning      (node --test tests/)
#   2. models load offline: Kokoro voices, both Whisper models, llama.cpp + GGUF, ComfyUI checkpoint presence
# For a full end-to-end render use: node tests/e2e-run.mjs cases   (needs the studio server running)
set -u
WS="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$WS"
fail=0
node --test tests/unit.test.mjs || fail=1
node --input-type=module -e "
import { getCatalog } from './dashboard/lib/catalog.js';
const c = getCatalog(true);
for (const l of c.languages) console.log((l.available ? 'OK  ' : 'NO  ') + l.id.padEnd(18) + (l.available ? l.voices.length + ' voices, align: ' + l.alignmentModel : l.problems.join('; ')));
const e = c.engines; console.log('LLM     ', e.llm.ready ? 'OK ' + e.llm.name : 'MISSING: ' + e.llm.reason); console.log('ComfyUI ', e.comfyui.ready ? 'OK ' + e.comfyui.model : 'MISSING: ' + e.comfyui.reason);
if (!c.languages.some((l) => l.available)) process.exit(1);
" || fail=1
[ $fail = 0 ] && echo "SELFTEST PASSED" || { echo "SELFTEST FAILED"; exit 1; }
