# Script pipeline — audit and architecture (2026-11-13)

All code is in `dashboard/lib/scriptgen.js` unless noted. Model = Gemma 3 4B (llama.cpp, JSON-schema constrained).

## Execution path (as built)

| # | Stage | Function | Input → output | Model? | Validation | Failure / retry | Persisted |
|---|---|---|---|---|---|---|---|
| 1 | Topic + config | `server.js submitScriptJob` → `pipeline.runScriptJob` | form input → validated config | no | `validate.js` | 422 to the UI | project.json |
| 2 | Fact file | `factcheck.findTopicFacts` | topic → fact file (verified / theories / legends / knownErrors / terms) | no | keyword match | none = "needs research" | — |
| 3 | Research | `researchTopic` | fact file + topic → essentials (typed), evidence, rejected, **brief** | yes (2 calls) | model claims self-checked, **never counted as verified**; contradictions with known errors | model failure → no research (plan still runs) | meta.research |
| 4 | Story architecture | `planStory` | evidence + essentials + **story type** → central story + one beat per line with fact refs | yes | beats == lines | null → write without plan | meta.plan |
| 5 | Names / terms | `topicNameSpellings` + fact-file `terms` | names → Devanagari spellings | yes | Devanagari only | ignored on failure | prompt only |
| 6 | Writing | `generateDirect` (all languages, native) | plan + rules → lines | yes (≤5 attempts) | language, story, Hinglish, terms, grounding, coverage, framing, numbers, duration | soft problems fed back; best valid attempt kept; truncation → bigger budget | meta.generationLog |
| 7 | Polish | `polishScript` | lines → lines | yes | guarded (digits, language) | keeps previous | meta.polish |
| 8 | Length fit (draft) | `fitLength` | lines → lines | yes (≤3 rounds) | per-line guards, greedy apply | logged, `improved:false` | meta.lengthFitLog |
| 9 | Proof-read | `reviewScript` | lines → corrected lines + issues | yes (≤3 rounds) | digits / language / length / facts guards | issues kept | meta.llmReview |
| 10 | Hook / ending | `improveHookEnding` | first/last line → rewrite | yes | deterministic only (judgment is advisory) | keeps previous | meta.hookEndingRewrite |
| 11 | Length fit (after review) | `fitLength` | lines → lines | yes | as 8 | as 8 | meta.lengthFitLog |
| 12 | Visuals | `describeVisuals` | final lines (+ plan beats) → one visual + structured shot per line | yes | — | keeps draft visuals | meta.visuals |
| 13 | Gates | `finalizeGates` → `qualityGates` → `readiness` | final script → gates + status + claim ledger | no | 10 gates (see below) | — | meta.gates / status / claims |
| 14 | Save | `pipeline.runScriptJob` → `projects.addScriptVersion` | script + meta → version N | no | language re-check | job fails | script/vNNN.json |
| 15 | Preview | `app.js loadScript` | newest version | no | shows that version's own gates | — | — |
| 16 | Edit in Script Studio | `server.js POST /scripts` | edited lines → new version | no | language + facts + **deterministic gates** (new) | 422 | new version; old kept |

## Root causes found (and what was done)

1. **Late rewrites invalidated earlier checks** — five model passes can rewrite lines after earlier validation. Fixed by
   computing every gate once, on the final saved text (`finalizeGates`), and re-running the fact review after each
   rewrite.
2. **Prompt contamination** — real names used as examples in the writing rules leaked into unrelated scripts
   ("Sher Shah Suri" in a vaccines script). Examples removed; regression test; and a **cross-topic name check** now
   flags names belonging to another topic's fact file.
3. **Research status was not a status** — "no verified source" only failed the facts gate (NEEDS_REVIEW). Now a
   separate RESEARCH gate and the overall status **NEEDS_RESEARCH**.
4. **One story shape for every topic** — the planner used the same structure for history, science and mystery.
   Now a topic type (history / science / mystery / explainer) selects the structure.
5. **Edited versions carried no validation** — saving an edit created a version without gates or status. Edits now get
   the deterministic gates immediately (labelled as such); no READY status can carry over from a previous version.
6. **Visual checks were lexical** — keyword overlap passed wrong scenes. Now: line subject vs shot subject/action,
   topic key terms, people/stock imagery, **period mismatch** (modern objects in historical lines) and **repeated
   visuals**; anything uncertain → review.
7. **Duration** — fixed earlier in this cycle: per-line fitting with logs, per-voice/per-language calibration from
   clean samples only, ±15 % stop before TTS.

## Gates → status

`research · facts · coverage · language · narrative (story) · terms · editorial · duration · visuals` → `readiness()`:

* language failed → **FAILED**
* research missing (no verified source, or model-only claims used) → **NEEDS_RESEARCH**
* any other gate failed → **NEEDS_REVIEW**
* all passed → **READY** (a high score elsewhere never compensates a failed gate)

The whole-script model judgment is **advisory only** (calibration: it rated a good reference script like a flat fact
list) — it never approves or triggers rewrites.

## Known limits (honest)

* Meaning-level errors with correct words ("gills pump blood") are not detectable without a stronger model.
* The claim checker matches numbers, names and known errors; it cannot verify a free-form causal claim.
* Gemma 3 4B frequently produces NEEDS_REVIEW scripts; that is the correct outcome, not a validator fault.

## Length fitting and meaning preservation (Steps 1–4)

- **One line per request** (`fitLength`): each call names one line, its word/character budget, the facts it must keep
  (numbers, number words, fact-file terms and their Hindi descriptive forms, English names), the read-only script and
  the previous/next lines. At most 2 attempts per line, 2×lines calls per stage; fitting stops inside ±8 %; if the
  local model is unreachable it stops at once and says so. Every attempt is logged (`meta.lengthFitLog`: raw answer,
  normalised answer, spoken `say`, sizes, seconds, reason).
- **Rejected answers**: echoed numbering is stripped; cut-off, empty, token loops, commentary, unchanged, extra
  sentences, another line's text, new/dropped numbers, lost protected terms/number words/causal links, fragments
  (no verb / no longer ends on a verb), too short/not shorter, overshoot.
- **Meaning** (`dashboard/lib/semantic.js`, verification only — it never writes text):
  1. `meaningDiff` (deterministic) compares the rewrite with the line *as fitting first found it*: negation, certainty
     (a hedge such as शायद/सकता dropped), cause/relationship words, counted qualifiers (पूरे, कई, बाकी…), destinations
     and places (word before तक/के बीच/में…, after to/into/between…), listed entities, the subject, and whole clauses
     (a clause that lost over half its content words = a dropped claim). High/medium → rejected.
  2. Only when content words were dropped/added and no rule explains them, `semanticReview` asks the model a yes/no
     question (max 6 per stage). Error, cut-off, malformed or contradictory answer → "unknown" → rejected.
     The 4B reviewer is lenient (it approved dropped clauses in real runs), so the deterministic rules carry the weight.
  3. `verifyScriptMeaning` checks the FINAL saved lines against `meta.lengthFitBase` → the `meaning` gate, with
     structured findings (line, original, final, changes, severity, evidence from the fact file, decision).
- **Hinglish foreign letters**: the seen failure was the Persian plural suffix "ها" on a Hindi word ("दशक‌ها" = दशकों),
  copied unchanged through all 5 retries. It is repaired deterministically (logged) before captions are built; any other
  foreign letter fails the language check with the exact word quoted; the prompt forbids Urdu/Arabic/Persian letters.

## Language quality (Step 5)

`dashboard/lib/langquality.js` — validation separate from correction. `languageIssues` (deterministic) checks Hindi
verb/auxiliary agreement, habitual verbs left without है (negatives like "नहीं होती" are correct and pass), genitive and
adjective gender with a small lexicon of everyday nouns, the sentence-initial subject's gender, doubled/stacked case
markers; English a/an, repeated words, subject-verb agreement, comma splices (both sides need a finite verb); spelling
consistency within a script (nukta/chandrabindu variants) and an opening pronoun with no referent. `correctLanguage`
runs after the final length fit: mechanical fixes first ("करते है" → "करते हैं", "का नदी" → "की नदी"), then one model
request per remaining error line; a correction is kept only if the error is gone, no new error appears, the numbers are
identical and `meaningDiff` reports no change at all (no model self-approval). The `grammar` gate fails on errors
(→ NEEDS_REVIEW); warnings are advisory.

## Visual-semantic intelligence (Step 6)

`dashboard/lib/visualsem.js` — validation (`visualReport`) is separate from correction (`correctVisuals`); neither
writes narration, script text or facts. Each scene is traced to its narration reference (English draft, story-plan
beat, English narration, the line's English words, fact-file English keys of Hindi terms in the line — the sources are
reported) and checked in seven categories: **alignment** (subject shown, using everyday synonyms and the words the fact
file uses with the line's term — the old exact-word check failed almost every script), **facts** (known errors of the
topic pictured, numbers or proper names no source mentions), **history** (modern objects, wrong era), **science**
(count of body parts, human anatomy for a non-human subject, sensational medical imagery), **diversity** (repeated
scenes, three identical compositions in a row), **continuity** (period jumps, a character changing appearance) and
**completeness** (missing visual or reference). Errors and uncertain findings fail the `visuals` gate (never READY);
warnings are advisory. `correctVisuals` sends only failing scenes to the model (max 4 calls), with the narration
read-only, and keeps a new visual only if re-validation clears that scene without creating a problem elsewhere.

## Image QA (Step 7) — actual pixels

`dashboard/lib/imageqa.js`. **Pixel-level technical checks (implemented, FFmpeg, no model):** decode/missing,
9:16 size, near-black / flat / blown-out (blown-out only when colour is also washed out — pastel illustrations are
fine), blank (entropy), black borders (16×28 dark-cell grid), duplicates and repeated compositions (64-bit difference
hash), colour-style jumps. **Pixel-level semantic checks (implemented, needs a vision model):** a vision model describes
the image without being told the narration; the Step 6 rules then check that description against the narration,
storyboard and fact file (wrong subject, counts, human anatomy, known errors, period, invented names/numbers), plus
visible text/watermarks and distortion. Without a vision model every image is NEEDS_REVIEW — never approved. Gates:
semantic, factual, accuracy (history/science), technical, continuity, overall; one critical image rejects the project.
`correctImages` regenerates only failed images (injected generator), keeps every version and reason, max 2 attempts,
keeps the original when nothing passes. Not yet wired into the render pipeline; the vision projector for the local
4B model (mmproj, 851 MB) is not installed.
