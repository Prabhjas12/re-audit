# Rule file format

Rule files live in `rules/` and are listed in `rules/index.json`. `npm run check-rules` validates all of them.

## Program files (majors, colleges, university)

```jsonc
{
  "id": "DS25",                       // referenced by transfer tables
  "kind": "major",                    // "major" | "college" | "university"
  "title": "Data Science B.S. (DS25)",
  "catalogYears": ["Fall 2024"],      // catalog years this was checked against
  "auditSection": "major",            // which ">> ... REQUIREMENTS <<" section of the audit to compare with
  "advisor": "Data Science Student Affairs (vac.ucsd.edu)",
  "sources": [{ "label": "...", "url": "..." }],
  "notes": ["Shown under Sources and notes in the report"],
  "policy": {
    "exclusive": true,                // one course counts toward one requirement in this program
    "minGrade": "C-",                 // lowest passing letter grade
    "letterGrade": true               // P/NP doesn't count
  },
  "groups": [{ "title": "Lower Division", "requirements": [ /* see below */ ] }],
  "checks": [ /* see below */ ]
}
```

### Requirements

Every requirement has an `id`, a `title`, an optional `audit` regex (matched against requirement titles in the audit's section; when it's missing or doesn't match, the requirement is paired with the audit requirement whose course list overlaps its options most), and exactly one of these shapes:

| Shape | Example | Meaning |
| --- | --- | --- |
| `slots` | `[["MATH 18","MATH 31AH"],["MATH 20A"]]` | One course per slot, each from its own list |
| `count` + `options` | `"count": 1, "options": ["CAT 125","CAT 125R"]` | N courses from one list |
| `count` + `distinctSubjects` | Social Analysis | N courses from different departments |
| `units` + `options` | `"units": 20` | At least this many units from the list |
| `oneOf` | `[{ "label": "Science", "slots": [["BILD 1"],["BILD 3"]] }, ...]` | Complete any one of these sequences |
| `auditOnly` | ELWR | Trust the official audit (and `historyEvent` from TSS Academic Events) |
| `manual` | Experiential Learning | Can't be checked from a course list; trust the audit, otherwise show `help` |

Optional fields: `except` (patterns to exclude), `suggest` (shown first in "what to take"), `help` (shown when unmet), `minGrade` / `letterGrade` (override the program policy), `upperDivision: true`, `transferTitleMatch` + `transferTitleSubjects` (let unmatched transfer courses count by title, mirroring the audit's own `ENGL* [*omp*]` style rules).

Colleges can define `variants` (`first-year`, `transfer-general`, `transfer-certified`), each with a `match` regex for the audit's status line and the list of requirement ids that apply, plus a `defaultVariant`.

### Course patterns

| Pattern | Matches |
| --- | --- |
| `DSC 102` | DSC 102, and its online version DSC 102R |
| `DSC 100-196` | Any DSC course numbered 100 to 196, any suffix |
| `HILD 2A-2C` | HILD 2A, 2B, 2C |
| `LTWR *` | Every LTWR course |
| `LT* 1-50` | Any subject starting with LT, numbered 1 to 50 |

### Checks

| `type` | Fields | Meaning |
| --- | --- | --- |
| `totalUnits` | `min` | Total units (repeats counted once) |
| `upperDivUnits` | `min`, `auditBlock` | Units in courses numbered 100–199 |
| `programUpperDivUnits` | `min`, `auditBlock` | Upper-division units applied to this program |
| `programGPA` | `min` | Estimated GPA in this program's courses |
| `pnpMax` | `maxShare` | Share of UC San Diego units taken P/NP |

## Transfer tables

```jsonc
{
  "school": "UCSC",
  "name": "UC Santa Cruz",
  "sources": [{ "label": "...", "url": "..." }],
  "courses": [
    {
      "code": "WRIT 2",                // as printed on the TSS audit
      "aliases": ["WRIT 002"],
      "title": "Rhetoric and Inquiry",
      "counts": [{ "program": "sixth-ge", "requirement": "tcomp", "confidence": "likely" }],
      "why": "Shown to students next to petitions"
    }
  ]
}
```

`confidence` is `"likely"` (advising should only need to apply it; status "Ask to apply") or `"petition"` (status "Petition").
