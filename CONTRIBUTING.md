# Adding your major, college, or transfer school

Re-Audit only knows the requirements someone has written down. Adding yours is mostly copying course lists into a JSON file, and it helps everyone in your program.

**Ground rules**

- Every rule file cites where its lists came from (catalog page, college PDF, or the `COURSES:` lines on a TSS audit).
- Never commit a real audit, academic history, name, or student number. Use made-up students in tests.
- Run `npm run check-rules` and `npm test` before opening a pull request.

The full file format is in [docs/RULES.md](docs/RULES.md).

## Add a major

1. Copy `rules/majors/DS25-FA2024.json` to `rules/majors/<CODE>-<CATALOG>.json`. `<CODE>` is the code in parentheses on your audit's major heading, like `(DS25)`.
2. Fill in the requirements from the General Catalog or your department's checklist. If you have your own audit, its `COURSES:` lists are a good cross-check, and you can put the audit's requirement titles in `"audit"` fields (a regex like `"^Senior Project"`). That's optional: without it, Re-Audit pairs each rule with the audit requirement whose course list overlaps most.
   When a rule is ambiguous, encode the stricter reading. If the official audit says a requirement is met, Re-Audit trusts it, so being strict can't produce a false "Ask to apply".
3. Set `"policy"`: majors are usually `{ "exclusive": true, "minGrade": "C-", "letterGrade": true }`.
4. Add an entry to `rules/index.json` under `"majors"` with both codes from the [major codes list](https://blink.ucsd.edu/instructors/academic-info/majors/major-codes.html): `"code"` (the old ISIS code, like `CS26`) and `"tssCode"` (like `CSE-BS-002`). Audits are matched on either.
5. Add a complete made-up student for your major to `COMPLETE` in `tests/majors.test.mjs`. The tests check that it satisfies everything and that an empty record satisfies nothing.

## Add a college

1. Copy `rules/colleges/sixth.json`. Set `"match": { "collegeName": "..." }` to the word that appears in the audit's college heading (for example `"REVELLE"`).
2. Use the same variant keys so the settings menu works: `first-year`, `transfer-general`, `transfer-certified`. Each variant lists the requirement ids that apply, and its `"match"` is a regex for the status line under the college heading on the audit (like `GENERAL TRANSFER STATUS`).
3. Add it to `rules/index.json` under `"colleges"`.

## Add a transfer school

Transfer classes without a UC San Diego equivalent appear under "Elective Courses" on the audit, even when advising might apply them to a GE or approve a petition. A transfer table says where they likely fit.

1. Copy `rules/transfer/UCSC.json` to `rules/transfer/<ID>.json`.
2. For each course, use the code exactly as it appears on the TSS audit (with any renamed subjects in `"aliases"`), and add a `"counts"` entry per requirement:
   - `"likely"`: it matches the requirement's own rule (for example a composition course for Transfer Composition), so advising should only need to apply it.
   - `"petition"`: a reasonable petition based on the course description. Say why in `"why"`; it's shown to students.
3. Add it to `rules/index.json` under `"transfer"`. The `"school"` id should match one of the schools `js/history-parser.js` recognizes in the External Work section, or add the school's name pattern there.

Only transfer classes with a lower-case `t` grade on the audit (no UC San Diego equivalent) go through transfer tables. Classes TSS already matched to a UC San Diego course (`T` grade) count automatically.
