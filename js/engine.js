// The matching engine: place every course into the requirements it can satisfy and
// compare the result with what the official audit says.

import { meetsMinGrade, earnsUnits, isUpperDivision, gradePoints, markRepeats, parseCode } from "./courses.js";
import { matchesAny, matchesOnlyBroadly, describeOptions } from "./patterns.js";
import { findAuditBlock } from "./audit-parser.js";

export const STATUS = {
  DONE: "DONE",               // satisfied, and the official audit agrees
  IN_PROGRESS: "IN_PROGRESS", // satisfied once current or planned classes finish
  FIX: "FIX",                 // satisfied by classes already on your record, but the official audit says it isn't
  PETITION: "PETITION",       // satisfied only if a transfer petition is approved
  NEED: "NEED",               // still needs classes
};

const TIER_SCORE = [3, 2, 1];

/**
 * @param {object} input
 *   courses        merged course list (audit + history)
 *   audit          parseAudit() result or null
 *   historyEvents  { elwr, ahi } from parseHistory()
 *   programs       rule objects: [university, major, college]
 *   transfer       transfer table for the student's previous school, or null
 *   variants       { [programId]: variantKey } to override detection
 */
export function evaluate({ courses, audit = null, historyEvents = {}, programs, transfer = null, variants = {} }) {
  const list = prepareCourses(courses);
  const transferIndex = indexTransfer(transfer);
  const results = [];
  for (const prog of programs) {
    if (!prog) continue;
    results.push(evaluateProgram(prog, list, { audit, historyEvents, transferIndex, variant: variants[prog.id] }));
  }
  const units = unitTotals(list);
  for (const r of results) {
    for (const ch of r.checks) runCheck(ch, r, list, units, audit);
  }
  const usage = courseUsage(list, results);
  const missingFromAudit = audit
    ? list.filter((c) => c.sources.includes("history") && !c.sources.includes("audit") && c.status === "completed" && !c.repeatOf)
    : [];
  return { courses: list, programs: results, units, usage, missingFromAudit, transferSchool: transfer ? transfer.name : null };
}

// ---------------------------------------------------------------- courses

function prepareCourses(courses) {
  const list = courses.map((c, i) => ({ ...c, id: i }));
  markRepeats(list);
  const pending = list.filter((c) => c.status === "in-progress" && c.termOrder != null);
  if (pending.length) {
    const current = Math.min(...pending.map((c) => c.termOrder));
    for (const c of pending) if (c.termOrder > current) c.status = "planned";
  }
  return list;
}

function indexTransfer(table) {
  const idx = new Map();
  if (!table) return idx;
  for (const e of table.courses || []) {
    for (const code of [e.code, ...(e.aliases || [])]) idx.set(code.toUpperCase().replace(/\s+/g, " "), e);
  }
  return idx;
}

// ---------------------------------------------------------------- programs

function resolveRequirements(prog, audit, override) {
  const all = [];
  for (const g of prog.groups) for (const r of g.requirements) all.push({ ...r, group: g.title });
  if (!prog.variants) return { reqs: all, variant: null };
  let key = override;
  if (!key && audit && audit.meta.collegeStatus) {
    key = Object.keys(prog.variants).find((k) => new RegExp(prog.variants[k].match, "i").test(audit.meta.collegeStatus));
  }
  key = key || prog.defaultVariant || Object.keys(prog.variants)[0];
  const ids = prog.variants[key].requirements;
  return { reqs: ids.map((id) => all.find((r) => r.id === id)).filter(Boolean), variant: { key, title: prog.variants[key].title } };
}

function normalize(req) {
  if (req.auditOnly) return { ...req, type: "auditOnly" };
  if (req.manual) return { ...req, type: "manual" };
  if (req.oneOf) return { ...req, type: "oneOf" };
  if (req.units) return { ...req, type: "units" };
  if (req.slots) return { ...req, type: "slots" };
  if (req.count && req.distinctSubjects) return { ...req, type: "distinct" };
  if (req.count) return { ...req, type: "slots", slots: Array.from({ length: req.count }, () => req.options || []) };
  return { ...req, type: "manual" };
}

function evaluateProgram(prog, courses, ctx) {
  const { reqs: raw, variant } = resolveRequirements(prog, ctx.audit, ctx.variant);
  const reqs = raw.map(normalize);
  const exclusive = prog.policy?.exclusive !== false;
  const route = makeRouter(prog, ctx.transferIndex);

  const placed = new Map(reqs.map((r) => [r.id, { applied: [], choice: null }]));
  const used = new Set();

  // Phase 1: requirements made of course slots (incl. "one of these sequences"), solved together
  // as a matching problem so one course never blocks a requirement that has no other option.
  const slotReqs = reqs.filter((r) => r.type === "slots" || r.type === "oneOf");
  const groupsToSolve = exclusive ? [slotReqs] : slotReqs.map((r) => [r]);
  for (const group of groupsToSolve) {
    const best = solveSlots(group, courses, route);
    for (const s of best.assignments) {
      placed.get(s.req.id).applied.push({ course: s.course, tier: s.edge.tier, via: s.edge.via, entry: s.edge.entry, slot: s.idx });
      if (exclusive) used.add(s.course.id);
    }
    for (const [reqId, choice] of best.choices) placed.get(reqId).choice = choice;
  }

  // Phase 2: unit totals and "two courses from different departments", most constrained first.
  const greedy = reqs.filter((r) => r.type === "units" || r.type === "distinct");
  const eligibleCount = (r) => courses.filter((c) => !used.has(c.id) && route(c, r, r.options)).length;
  greedy.sort((a, b) => eligibleCount(a) - eligibleCount(b) || reqs.indexOf(a) - reqs.indexOf(b));
  for (const r of greedy) {
    const cands = courses
      .filter((c) => !(exclusive && used.has(c.id)))
      .map((c) => ({ c, e: route(c, r, r.options) }))
      .filter((x) => x.e)
      .sort((a, b) => a.e.tier - b.e.tier || a.e.specificity - b.e.specificity || (b.c.units || 0) - (a.c.units || 0) || (a.c.termOrder ?? 0) - (b.c.termOrder ?? 0));
    const p = placed.get(r.id);
    if (r.type === "units") {
      let have = 0;
      for (const { c, e } of cands) {
        if (have >= r.units) break;
        p.applied.push({ course: c, tier: e.tier, via: e.via, entry: e.entry });
        have += c.units || 0;
        if (exclusive) used.add(c.id);
      }
    } else {
      const subjects = new Set();
      for (const { c, e } of cands) {
        if (p.applied.length >= r.count) break;
        if (subjects.has(c.subject)) continue;
        subjects.add(c.subject);
        p.applied.push({ course: c, tier: e.tier, via: e.via, entry: e.entry });
        if (exclusive) used.add(c.id);
      }
    }
  }

  const officialByReq = officialMap(prog, reqs, ctx.audit);
  const requirements = reqs.map((r) => finishRequirement(r, placed.get(r.id), prog, courses, route, { ...ctx, officialByReq }));
  const allOptions = reqs.flatMap((r) => (r.oneOf ? r.oneOf.flatMap((o) => o.slots.flat()) : r.slots ? r.slots.flat() : r.options || []));
  const result = {
    id: prog.id, kind: prog.kind, title: prog.title, variant, advisor: prog.advisor,
    sources: prog.sources || [], notes: prog.notes || [], catalogYears: prog.catalogYears || null,
    requirements,
    checks: (prog.checks || []).map((ch) => ({ ...ch })),
  };
  Object.defineProperty(result, "_allOptions", { value: [...new Set(allOptions)], enumerable: false });
  return result;
}

function optionsOf(r) {
  if (r.oneOf) return r.oneOf.flatMap((o) => o.slots.flat());
  if (r.slots) return r.slots.flat();
  return r.options || [];
}

/**
 * Pair each rule requirement with the official audit's requirement, so we know what TSS says about it.
 * First by the rule's "audit" title pattern; then, for rules without one (or when titles differ),
 * by which audit requirement's course list overlaps the rule's options the most.
 */
export function officialMap(prog, reqs, audit) {
  const map = new Map();
  if (!audit) return map;
  const candidates = audit.blocks.filter((b) => b.section === prog.auditSection).flatMap((b) => b.requirements);
  const used = new Set();
  for (const r of reqs) {
    if (!r.audit) continue;
    const re = new RegExp(r.audit, "i");
    const hit = candidates.find((c) => !used.has(c) && re.test(c.title));
    if (hit) { map.set(r.id, hit); used.add(hit); }
  }
  const pairs = [];
  for (const r of reqs) {
    if (map.has(r.id) || r.auditOnly || r.manual) continue;
    const opts = optionsOf(r);
    if (!opts.length) continue;
    for (const c of candidates) {
      if (used.has(c)) continue;
      const codes = [...new Set([...(c.listedCodes || []), ...c.courses.filter((x) => x.origin !== "transfer").map((x) => x.code)])];
      if (!codes.length) continue;
      const hits = codes.filter((code) => { const p = parseCode(code); return p && matchesAny(p, opts); }).length;
      const score = hits / codes.length;
      if (hits && score >= 0.5) pairs.push({ r, c, score, hits });
    }
  }
  pairs.sort((a, b) => b.score - a.score || b.hits - a.hits);
  for (const p of pairs) {
    if (map.has(p.r.id) || used.has(p.c)) continue;
    map.set(p.r.id, p.c); used.add(p.c);
  }
  return map;
}

/** Decide whether a course can fill a requirement (slot). Returns { tier, via, entry, specificity } or null. */
function makeRouter(prog, transferIndex) {
  return function route(course, req, slotOptions) {
    if (course.repeatOf) return null;
    if (!["completed", "in-progress", "planned"].includes(course.status)) return null;
    const minGrade = req.minGrade ?? prog.policy?.minGrade;
    const letter = req.letterGrade ?? prog.policy?.letterGrade;
    if (course.status === "completed" && !meetsMinGrade(course.grade, minGrade, { letterRequired: letter })) return null;
    if (req.upperDivision && !isUpperDivision(course)) return null;
    const pendingTier = course.status === "completed" ? 0 : 1;

    if (course.origin === "transfer") {
      const entry = transferIndex.get(course.code);
      const hit = entry && entry.counts.find((x) => x.program === prog.id && x.requirement === req.id);
      if (hit) {
        const petition = hit.confidence === "petition";
        return { tier: petition ? 2 : pendingTier, via: petition ? "petition" : "transfer-likely", entry, specificity: entry.counts.length };
      }
      if (req.transferTitleMatch && new RegExp(req.transferTitleMatch, "i").test(course.title || "") &&
          (!req.transferTitleSubjects || req.transferTitleSubjects.includes(course.subject))) {
        return { tier: pendingTier, via: "transfer-title", entry: null, specificity: 0 };
      }
      return null;
    }
    const opts = slotOptions ?? req.options;
    if (!matchesAny(course, opts)) return null;
    if (req.except && matchesAny(course, req.except)) return null;
    return { tier: pendingTier, via: "rule", entry: null, specificity: 0, broad: matchesOnlyBroadly(course, opts) ? 1 : 0 };
  };
}

function solveSlots(reqs, courses, route) {
  const oneOfs = reqs.filter((r) => r.type === "oneOf");
  const combos = cartesian(oneOfs.map((r) => r.oneOf.map((_, i) => i)));
  let best = null;
  for (const combo of combos) {
    const slots = [];
    const choices = new Map();
    for (const r of reqs) {
      let lists = r.slots;
      if (r.type === "oneOf") {
        const ci = combo[oneOfs.indexOf(r)];
        choices.set(r.id, ci);
        lists = r.oneOf[ci].slots;
      }
      lists.forEach((opts, idx) => slots.push({ req: r, idx, opts }));
    }
    const match = maxMatching(slots, courses, (s, c) => route(c, s.req, s.opts));
    const score = match.reduce((sum, m) => sum + (m ? TIER_SCORE[m.edge.tier] : 0), 0);
    if (!best || score > best.score) {
      best = {
        score, choices,
        assignments: match.map((m, i) => (m ? { req: slots[i].req, idx: slots[i].idx, course: courses[m.edge.j], edge: m.edge } : null)).filter(Boolean),
      };
    }
  }
  return best || { score: 0, choices: new Map(), assignments: [] };
}

/** Bipartite matching of slots to courses, preferring completed (tier 0) over in-progress (1) over petitions (2). */
function maxMatching(slots, courses, edgeFn) {
  const edges = slots.map((s) =>
    courses.map((c, j) => { const e = edgeFn(s, c); return e ? { j, ...e } : null; }).filter(Boolean)
      .sort((a, b) => a.tier - b.tier || (a.broad || 0) - (b.broad || 0) || a.specificity - b.specificity || (courses[a.j].termOrder ?? 0) - (courses[b.j].termOrder ?? 0)));
  const courseSlot = new Map();
  const slotEdge = new Array(slots.length).fill(null);
  const assign = (i, e) => {
    if (slotEdge[i]) courseSlot.delete(slotEdge[i].j);
    slotEdge[i] = e; courseSlot.set(e.j, i);
  };
  const tryAugment = (i, maxTier, seen) => {
    const cand = edges[i].filter((e) => e.tier <= maxTier);
    for (const e of cand) if (!courseSlot.has(e.j)) { assign(i, e); return true; }
    for (const e of cand) {
      if (seen.has(e.j)) continue;
      seen.add(e.j);
      const other = courseSlot.get(e.j);
      if (tryAugment(other, maxTier, seen)) { assign(i, e); return true; }
    }
    return false;
  };
  for (const maxTier of [0, 1, 2]) {
    for (let i = 0; i < slots.length; i++) if (!slotEdge[i]) tryAugment(i, maxTier, new Set());
  }
  return slotEdge.map((e) => (e ? { edge: e } : null));
}

function cartesian(arrays) {
  return arrays.reduce((acc, arr) => acc.flatMap((a) => arr.map((x) => [...a, x])), [[]]);
}

// ---------------------------------------------------------------- statuses

function finishRequirement(r, p, prog, courses, route, ctx) {
  const official = (ctx.officialByReq && ctx.officialByReq.get(r.id)) || null;
  // Mark classes the official audit already applies here, so advising messages only ask for the rest.
  const onAudit = new Set((official ? official.courses : []).map((c) => `${c.code}|${c.term}`));
  for (const a of p.applied) a.alreadyOnAudit = onAudit.has(`${a.course.code}|${a.course.term}`);
  const out = {
    id: r.id, title: r.title, group: r.group, type: r.type, help: r.help || null,
    applied: p.applied.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || (a.course.termOrder ?? 0) - (b.course.termOrder ?? 0)),
    official: official ? { met: official.met, needs: official.needs, title: official.title } : null,
    progress: null, missing: [], choice: null, satisfied: false, status: STATUS.NEED, notes: [],
  };

  if (r.type === "auditOnly") {
    const event = r.historyEvent && ctx.historyEvents[r.historyEvent];
    out.satisfied = Boolean(event || (official && official.met));
    out.status = out.satisfied ? STATUS.DONE : STATUS.NEED;
    out.progress = out.satisfied ? (official && official.met ? "Satisfied per official audit" : "Satisfied per TSS Academic History") : "Not shown as satisfied";
    return out;
  }
  if (r.type === "manual") {
    out.satisfied = Boolean(official && official.met);
    out.status = out.satisfied ? STATUS.DONE : STATUS.NEED;
    out.progress = out.satisfied ? "Satisfied per official audit" : "Can't be checked from a course list";
    return out;
  }

  if (r.type === "units") {
    const have = sumUnits(out.applied);
    out.satisfied = have >= r.units;
    out.progress = `${fmt(Math.min(have, r.units))} of ${r.units} units`;
    if (!out.satisfied) {
      const left = r.units - have;
      out.missing.push({ text: `${fmt(left)} more unit${left === 1 ? "" : "s"} from the approved list`, options: r.suggest || r.options });
    }
  } else if (r.type === "distinct") {
    out.satisfied = out.applied.length >= r.count;
    out.progress = `${out.applied.length} of ${r.count} courses`;
    if (!out.satisfied) {
      const taken = new Set(out.applied.map((a) => a.course.subject));
      const opts = (r.suggest || r.options).filter((o) => !taken.has(o.split(" ")[0]));
      out.missing.push({ text: `${r.count - out.applied.length} more from a different department`, options: opts });
    }
  } else {
    // slots / oneOf
    let lists = r.slots;
    if (r.type === "oneOf") {
      out.choice = r.oneOf[p.choice ?? 0].label;
      lists = r.oneOf[p.choice ?? 0].slots;
    }
    const filled = new Set(out.applied.map((a) => a.slot));
    out.satisfied = filled.size >= lists.length;
    out.progress = `${filled.size} of ${lists.length} course${lists.length === 1 ? "" : "s"}`;
    if (r.type === "oneOf" && !out.satisfied) {
      // Show every sequence that's as close as the chosen one.
      const alt = r.oneOf.map((o) => {
        const have = o.slots.filter((opts) => courses.some((c) => route(c, r, opts))).length;
        return { label: o.label, have, missing: o.slots.filter((opts) => !courses.some((c) => route(c, r, opts))) };
      });
      const top = Math.max(...alt.map((a) => a.have));
      for (const a of alt.filter((x) => x.have === top)) {
        out.missing.push({ text: `${a.label}: take ${a.missing.map((m) => describeOptions(m)).join(" and ")}`, options: a.missing.flat(), alt: true });
      }
    } else {
      lists.forEach((opts, i) => {
        if (filled.has(i)) return;
        const text = opts.length ? describeOptions(opts) : (r.help || "See your advisor for options");
        out.missing.push({ text, options: opts });
      });
    }
  }

  // Classes that were attempted but don't count (D in a C- requirement, NP, withdrawn) are worth naming.
  const near = courses.filter((c) => !c.repeatOf && c.status === "completed" && !out.applied.some((a) => a.course.id === c.id) &&
    c.origin !== "transfer" && matchesAny(c, r.type === "oneOf" ? r.oneOf.flatMap((o) => o.slots.flat()) : (r.slots ? r.slots.flat() : r.options || [])) &&
    !meetsMinGrade(c.grade, r.minGrade ?? prog.policy?.minGrade, { letterRequired: r.letterGrade ?? prog.policy?.letterGrade }));
  for (const c of near) out.notes.push(`${c.code} (${c.grade}, ${c.term}) doesn't count: ${prog.policy?.letterGrade ? "this requirement needs a letter grade of " + (prog.policy?.minGrade || "C-") + " or better" : "grade too low"}.`);

  const anyPetition = out.applied.some((a) => a.tier === 2);
  const anyLikely = out.applied.some((a) => a.via === "transfer-likely");
  const anyPending = out.applied.some((a) => a.course.status !== "completed");
  if (out.satisfied) {
    if (anyPetition) out.status = STATUS.PETITION;
    else if (official && !official.met && !anyPending) out.status = STATUS.FIX;
    else if (anyLikely && official && !official.met) out.status = STATUS.FIX;
    else if (anyPending) out.status = STATUS.IN_PROGRESS;
    else out.status = STATUS.DONE;
    if (official && !official.met && anyPending && out.status === STATUS.IN_PROGRESS) {
      out.notes.push("The official audit doesn't count these classes yet.");
    }
  } else if (official && official.met) {
    out.status = STATUS.DONE;
    out.notes.push("Satisfied per the official audit (exam credit or another course this tool can't see).");
  } else {
    out.status = STATUS.NEED;
  }
  return out;
}

function sumUnits(applied) {
  return applied.reduce((s, a) => s + (a.course.units || 0), 0);
}
function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------- units and checks

/** Units earned now, in progress, planned, and upper-division, counting each repeated course once. */
export function unitTotals(courses) {
  const t = { earned: 0, inProgress: 0, planned: 0, ud: { earned: 0, inProgress: 0, planned: 0 }, replacedByRetake: 0, udReplacedByRetake: 0, ucsdUnits: 0, ucsdPnpUnits: 0 };
  for (const c of courses) {
    const u = c.units || 0;
    const ud = isUpperDivision(c);
    if (c.status === "completed" && earnsUnits(c)) {
      if (c.repeatOf && c.repeatBestStatus === "completed") continue; // superseded by a better finished attempt
      t.earned += u; if (ud) t.ud.earned += u;
      if (c.repeatOf) { t.replacedByRetake += u; if (ud) t.udReplacedByRetake += u; } // a retake is under way; no extra credit
    } else if (c.status === "in-progress" && !c.repeatOf) {
      t.inProgress += u; if (ud) t.ud.inProgress += u;
    } else if (c.status === "planned" && !c.repeatOf) {
      t.planned += u; if (ud) t.ud.planned += u;
    }
    if (c.origin === "ucsd" && c.status === "completed" && !c.repeatOf) {
      t.ucsdUnits += u;
      if (c.passNoPass || c.grade === "P" || c.grade === "NP") t.ucsdPnpUnits += u;
    }
  }
  t.projected = t.earned - t.replacedByRetake + t.inProgress + t.planned;
  t.ud.projected = t.ud.earned - t.udReplacedByRetake + t.ud.inProgress + t.ud.planned;
  return t;
}

function runCheck(ch, progResult, courses, units, audit) {
  const official = ch.auditBlock && audit ? findAuditBlock(audit, ch.auditBlock) : null;
  ch.official = official ? { met: official.needs == null, needs: official.needs } : null;
  if (ch.type === "totalUnits" || ch.type === "upperDivUnits") {
    const u = ch.type === "totalUnits" ? units : units.ud;
    setUnitsStatus(ch, u.earned, u.projected);
  } else if (ch.type === "programUpperDivUnits") {
    const seen = new Set();
    let now = 0, proj = 0;
    for (const r of progResult.requirements) for (const a of r.applied) {
      const c = a.course;
      if (seen.has(c.id) || !isUpperDivision(c)) continue;
      seen.add(c.id);
      if (c.status === "completed") now += c.units || 0;
      proj += c.units || 0;
    }
    setUnitsStatus(ch, now, proj);
  } else if (ch.type === "programGPA") {
    // Every letter-graded UC San Diego attempt of a course that appears in the major's lists,
    // including Ds and Fs, except attempts already replaced by a finished retake.
    const majorOptions = progResult._allOptions || [];
    let pts = 0, u = 0;
    for (const c of courses) {
      if (c.origin !== "ucsd" || c.status !== "completed") continue;
      if (c.repeatOf && c.repeatBestStatus === "completed") continue;
      const gp = gradePoints(c.grade);
      if (gp == null || !matchesAny(c, majorOptions)) continue;
      pts += gp * (c.units || 0); u += c.units || 0;
    }
    const gpa = u ? pts / u : null;
    ch.have = gpa == null ? null : Math.round(gpa * 1000) / 1000;
    ch.status = gpa == null ? STATUS.NEED : gpa >= ch.min ? STATUS.DONE : STATUS.NEED;
    ch.detail = gpa == null ? "No graded UC San Diego major courses yet" : `About ${gpa.toFixed(2)} across ${fmt(u)} letter-graded UC San Diego units in major courses (estimate; TSS shows the official number)`;
  } else if (ch.type === "pnpMax") {
    const share = units.ucsdUnits ? units.ucsdPnpUnits / units.ucsdUnits : 0;
    ch.have = share;
    ch.status = share <= ch.maxShare ? STATUS.DONE : STATUS.NEED;
    ch.detail = `${fmt(units.ucsdPnpUnits)} of ${fmt(units.ucsdUnits)} UC San Diego units (${Math.round(share * 100)}%)`;
  }
}

function setUnitsStatus(ch, now, projected) {
  ch.have = now; ch.projected = projected;
  if (now >= ch.min) ch.status = STATUS.DONE;
  else if (projected >= ch.min) ch.status = STATUS.IN_PROGRESS;
  else ch.status = STATUS.NEED;
  ch.detail = `${fmt(now)} earned` + (projected !== now ? `, ${fmt(projected)} with current and planned classes` : "") + ` (need ${ch.min})`;
  if (ch.official && !ch.official.met && ch.status !== STATUS.NEED && now >= ch.min) ch.status = STATUS.FIX;
}

function courseUsage(courses, results) {
  const usage = new Map(courses.map((c) => [c.id, []]));
  for (const r of results) for (const req of r.requirements) for (const a of req.applied) {
    usage.get(a.course.id).push({ program: r.title, kind: r.kind, requirement: req.title, via: a.via, tier: a.tier });
  }
  return usage;
}
