# Lezer Markdown 1.7.2 link parser patch

`@lezer__markdown@1.7.2.patch` targets **only `@lezer/markdown@1.7.2`** and
changes both published ESM (`dist/index.js`) and CJS (`dist/index.cjs`) files.
`pnpm install --frozen-lockfile` applies it reproducibly to the workspace,
including CodeMirror’s transitive parser dependency.

A completed link used to scan every earlier inline part to invalidate open
links, including markers already invalidated by previous links. The patch
preserves three invariants:

1. A new inline context starts with `linkMarkCutoff = 0`.
2. Every link opener before the cutoff has already been invalidated. Completing
   a link scans only the new interval, then advances the cutoff to `i + 1`.
3. `takeContent` clamps the cutoff when nested image/link content truncates the
   parts array, so newly appended openers cannot be skipped.

Nearest-opener lookup, invalid opener removal, image nesting, URL/title parsing
and reference syntax stay unchanged. Only the repeated historical invalidation
scan becomes linear in newly added parts; this does not claim that every parser
path is linear. Tests reverse the patch to recover the published parser and
compare CommonMark/GFM trees, seeded mixed syntax and incremental fragments in
both module formats; an instrumented loop-count regression checks the scan cost.

On Node 24.18.0 / Apple M4 with Happy DOM and a fixed production Live Preview
snapshot, the same 10,000-line giant paragraph measured 357.36 → 50.72 ms median
input dispatch (five samples). The 50,000-line fixture measured 7,460.83 → 262.79 ms
for one input sample. Each physical line contains emphasis and a Markdown link;
there are no blank lines, so the entire fixture is one Markdown paragraph.
These are synthetic CodeMirror timings, not Zotero/Gecko or real-user guarantees;
263 ms can still be visible input latency. Viewport rendering changes are excluded
from this comparison.

Before upgrading this dependency, check whether upstream has removed the repeated
scan and rerun the differential, incremental and complexity regressions. If the
upstream fix is equivalent, remove this patch and its `pnpm.patchedDependencies`
registration, then regenerate the lockfile. Otherwise rebase the patch on the
new exact version; do not carry these offsets into a different release blindly.
