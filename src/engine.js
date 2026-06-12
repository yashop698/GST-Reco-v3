// ═══════════════════════════════════════════════════════════
// GST RECONCILIATION ENGINE
// Books (purchase register) vs GSTR-2B portal data.
// Legal grounding (CGST Act, 2017):
//  - S.16(2)(aa) + Rule 36(4): ITC only when the invoice appears in GSTR-2B
//  - S.16(4): ITC time limit — 30 Nov following the FY of the invoice
//  - S.77 CGST / S.19 IGST: tax paid under wrong head (IGST vs CGST+SGST)
//  - S.34: credit/debit notes
//  - S.170: rounding to the nearest rupee (per-head ₹1 tolerance is defensible)
// ═══════════════════════════════════════════════════════════

export const normalizeGST = (v) =>
  (v || "").toString().trim().toUpperCase().replace(/\s+/g, "");

export const normalizeAmt = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(v.toString().replace(/,/g, "").trim());
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};

export const normalizeDate = (d) => {
  if (!d && d !== 0) return "";
  if (typeof d === "number") {
    // Excel serial date → ISO
    try {
      const ms = Math.round((d - 25569) * 86400 * 1000);
      const dt = new Date(ms);
      if (!isNaN(dt.getTime()))
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    } catch {}
  }
  const s = d.toString().trim();
  const mx = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mx) {
    const yr = mx[3].length === 2 ? "20" + mx[3] : mx[3];
    return `${yr}-${mx[2].padStart(2, "0")}-${mx[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
};

// GSTN portal treats invoice numbers loosely: case, spaces, special chars,
// leading zeros all vary between books and 2B. Two levels:
export const normInv = (v) =>
  (v || "").toString().trim().toUpperCase().replace(/\s+/g, "");
export const fuzzyInv = (v) =>
  normInv(v).replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");

// ── GSTIN structural validation (15 chars + MOD-36 check digit) ──
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const gstinCheckDigit = (g14) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = B36.indexOf(g14[i]);
    if (v < 0) return null;
    const f = (i % 2 === 0 ? 1 : 2) * v;
    sum += Math.floor(f / 36) + (f % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
};

export const isValidGSTIN = (g) => {
  const s = normalizeGST(g);
  if (s.length !== 15 || !GSTIN_RE.test(s)) return false;
  return gstinCheckDigit(s.slice(0, 14)) === s[14];
};

// ── S.16(4): ITC deadline = 30 Nov following the FY of the invoice ──
export const itcDeadline = (isoDate) => {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || "");
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  const fyEnd = mo >= 4 ? y + 1 : y; // Indian FY ends 31 Mar
  return `${fyEnd}-11-30`;
};

export const pastItcDeadline = (isoDate, today = new Date()) => {
  const dl = itcDeadline(isoDate);
  if (!dl) return false;
  return today.toISOString().slice(0, 10) > dl;
};

// ── Rate sanity: combined GST rates in force ──
const GST_RATES = [0, 0.001, 0.0025, 0.01, 0.015, 0.03, 0.05, 0.12, 0.18, 0.28, 0.40];
export const rateLooksValid = (taxable, totalTax) => {
  if (!taxable || !totalTax) return true; // nothing to test
  const r = totalTax / taxable;
  return GST_RATES.some((g) => Math.abs(r - g) < 0.002);
};

// S.170 rounding: each head rounded to the nearest rupee, so a ₹1/head
// drift is statutory noise. Default tolerance ₹1, configurable.
export const amtClose = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// ═══ Row-level diagnostics (per-record statutory checks) ═══
export function rowChecks(r) {
  const issues = [];
  const g = normalizeGST(r.gst);
  const cg = normalizeAmt(r.cgst), sg = normalizeAmt(r.sgst), ig = normalizeAmt(r.igst);
  const tx = normalizeAmt(r.taxableValue);
  if (g && !isValidGSTIN(g)) issues.push("Invalid GSTIN (structure/check digit)");
  if (cg && sg && !amtClose(cg, sg, 1))
    issues.push(`CGST ≠ SGST (₹${cg} vs ₹${sg}) — must be equal on intra-State supply`);
  if (ig && (cg || sg))
    issues.push("Both IGST and CGST/SGST charged — a supply is either inter- or intra-State");
  if (tx && !rateLooksValid(tx, ig + cg + sg))
    issues.push(`Effective rate ${(((ig + cg + sg) / tx) * 100).toFixed(2)}% is not a notified GST rate`);
  return issues;
}

// ═══ Duplicate detection (same GSTIN + invoice no twice on one side
//     → double-booked ITC, excess claim risk under S.73/74) ═══
export function findDuplicates(pool) {
  const seen = new Map();
  const dups = [];
  pool.forEach((r, i) => {
    const g = normalizeGST(r.gst), inv = fuzzyInv(r.invoiceNo);
    if (!g || !inv) return;
    const k = `${g}|${inv}`;
    if (seen.has(k)) dups.push({ first: seen.get(k), dup: i, key: k });
    else seen.set(k, i);
  });
  return dups;
}

// ═══════════════════════════════════════════════════════════
// MATCHING
// Tier order (most → least reliable):
//  PERFECT      GSTIN + invoice no + all four amounts
//  FUZZY_INV    GSTIN + amounts + fuzzy invoice no (formatting noise only)
//  HIGH         GSTIN + amounts + date, invoice nos differ (CN/DN, S.34)
//  MEDIUM_AMT   GSTIN + amounts, date differs (period/amendment)
//  HEAD_SWAP    GSTIN + taxable + total tax equal but IGST↔CGST+SGST swapped
//               (wrong head — S.77 CGST / S.19 IGST: pay correct head, refund wrong)
//  MEDIUM_TAX   GSTIN + taxable + date, tax amounts differ
//  LOW          GSTIN + invoice total only
//  UNMATCHED_A  Books only → ITC NOT available, S.16(2)(aa)/Rule 36(4)
//  UNMATCHED_B  2B only → not booked; claim before S.16(4) deadline
// Credit notes: amounts matched on absolute value when both sides carry
// consistent signs; a sign flip alone is not treated as a mismatch.
// ═══════════════════════════════════════════════════════════

export function reconcile(A, B, opts = {}) {
  const tol = opts.tolerance ?? 1;
  const today = opts.today ? new Date(opts.today) : new Date();
  const out = [];
  const usedB = new Set();

  const anyGstA = A.some((r) => normalizeGST(r.gst).length > 0);
  const anyGstB = B.some((r) => normalizeGST(r.gst).length > 0);
  const useGst = anyGstA && anyGstB;

  // Index B by GSTIN so matching is O(n) per row instead of O(n²)
  const bIdx = new Map();
  B.forEach((b, i) => {
    const k = useGst ? normalizeGST(b.gst) : "*";
    if (!bIdx.has(k)) bIdx.set(k, []);
    bIdx.get(k).push(i);
  });

  const candidates = (gA) => {
    if (!useGst) return bIdx.get("*") || [];
    return gA ? bIdx.get(gA) || [] : [];
  };

  const findB = (gA, pred) => {
    for (const i of candidates(gA)) {
      if (!usedB.has(i) && pred(B[i])) return { r: B[i], i };
    }
    return null;
  };

  const abs = Math.abs;

  for (const a of A) {
    const gA = normalizeGST(a.gst);
    const taxA = normalizeAmt(a.taxableValue);
    const igA = normalizeAmt(a.igst);
    const cgA = normalizeAmt(a.cgst);
    const sgA = normalizeAmt(a.sgst);
    const invA = normInv(a.invoiceNo);
    const finvA = fuzzyInv(a.invoiceNo);
    const dtA = normalizeDate(a.invoiceDate);
    const ivA = normalizeAmt(a.invoiceValue) || taxA + igA + cgA + sgA;
    const totTaxA = igA + cgA + sgA;

    const iOk = (b) => invA && normInv(b.invoiceNo) === invA;
    const fiOk = (b) => finvA && fuzzyInv(b.invoiceNo) === finvA;
    // |x| comparison so credit notes booked negative still pair with 2B CDNR rows
    const aOk = (b) =>
      amtClose(abs(normalizeAmt(b.taxableValue)), abs(taxA), tol) &&
      amtClose(abs(normalizeAmt(b.igst)), abs(igA), tol) &&
      amtClose(abs(normalizeAmt(b.cgst)), abs(cgA), tol) &&
      amtClose(abs(normalizeAmt(b.sgst)), abs(sgA), tol);
    const dOk = (b) => {
      const d = normalizeDate(b.invoiceDate);
      return dtA && d && d === dtA;
    };
    const txOk = (b) => amtClose(abs(normalizeAmt(b.taxableValue)), abs(taxA), tol);
    const headSwap = (b) => {
      const bIg = normalizeAmt(b.igst), bCg = normalizeAmt(b.cgst), bSg = normalizeAmt(b.sgst);
      const totB = abs(bIg) + abs(bCg) + abs(bSg);
      if (!txOk(b) || !amtClose(totB, abs(totTaxA), 2 * tol)) return false;
      // one side IGST-only, the other CGST+SGST-only
      const aIsI = abs(igA) > 0 && !cgA && !sgA;
      const bIsI = abs(bIg) > 0 && !bCg && !bSg;
      return (aIsI && !bIsI && (abs(bCg) > 0 || abs(bSg) > 0)) ||
             (!aIsI && bIsI && (abs(cgA) > 0 || abs(sgA) > 0));
    };

    const issuesA = rowChecks(a);
    const deadlineNote = pastItcDeadline(dtA, today)
      ? ` ⚠ S.16(4): ITC deadline (${itcDeadline(dtA)}) has passed.`
      : "";

    let f;

    f = findB(gA, (b) => iOk(b) && aOk(b));
    if (f) { usedB.add(f.i); out.push({ a, b: f.r, type: "PERFECT", notes: "GSTIN, invoice number & all tax amounts match.", issues: issuesA.concat(rowChecks(f.r)) }); continue; }

    f = findB(gA, (b) => fiOk(b) && aOk(b));
    if (f) { usedB.add(f.i); out.push({ a, b: f.r, type: "FUZZY_INV", notes: `Amounts match; invoice nos differ only in formatting (${a.invoiceNo || "—"} vs ${f.r.invoiceNo || "—"}).`, issues: issuesA.concat(rowChecks(f.r)) }); continue; }

    f = findB(gA, (b) => aOk(b) && dOk(b));
    if (f) { usedB.add(f.i); out.push({ a, b: f.r, type: "HIGH", notes: `GSTIN, all amounts & date match — invoice nos differ (${a.invoiceNo || "—"} vs ${f.r.invoiceNo || "—"}). Possible CN/DN (S.34).`, issues: issuesA.concat(rowChecks(f.r)) }); continue; }

    f = findB(gA, (b) => aOk(b));
    if (f) { usedB.add(f.i); out.push({ a, b: f.r, type: "MEDIUM_AMT", notes: `GSTIN & amounts match — date differs (${a.invoiceDate || "?"} vs ${f.r.invoiceDate || "?"}). Different period or amendment.${deadlineNote}`, issues: issuesA.concat(rowChecks(f.r)) }); continue; }

    f = findB(gA, headSwap);
    if (f) { usedB.add(f.i); out.push({ a, b: f.r, type: "HEAD_SWAP", notes: "Taxable & total tax match but IGST ↔ CGST+SGST are swapped — tax under wrong head. S.77 CGST / S.19 IGST: pay under correct head, claim refund of wrong head; ITC only under the correct head.", issues: issuesA.concat(rowChecks(f.r)) }); continue; }

    f = findB(gA, (b) => dOk(b) && txOk(b));
    if (f) {
      const di = (normalizeAmt(f.r.igst) - igA).toFixed(2);
      const dc = (normalizeAmt(f.r.cgst) - cgA).toFixed(2);
      const ds = (normalizeAmt(f.r.sgst) - sgA).toFixed(2);
      usedB.add(f.i);
      out.push({ a, b: f.r, type: "MEDIUM_TAX", notes: `GSTIN, taxable & date match — tax differs. ΔIGST:₹${di} ΔCGST:₹${dc} ΔSGST:₹${ds}. ITC restricted to amount in GSTR-2B (S.16(2)(aa)).`, issues: issuesA.concat(rowChecks(f.r)) });
      continue;
    }

    f = findB(gA, (b) => {
      const bIV = normalizeAmt(b.invoiceValue) || normalizeAmt(b.taxableValue) + normalizeAmt(b.igst) + normalizeAmt(b.cgst) + normalizeAmt(b.sgst);
      return amtClose(abs(bIV), abs(ivA), 5);
    });
    if (f) { usedB.add(f.i); out.push({ a, b: f.r, type: "LOW", notes: "GSTIN & invoice total only match — other fields differ. Manual check.", issues: issuesA.concat(rowChecks(f.r)) }); continue; }

    out.push({ a, b: null, type: "UNMATCHED_A", notes: `In books but not in GSTR-2B — ITC NOT available until supplier reports it (S.16(2)(aa), Rule 36(4)). Follow up with supplier.${deadlineNote}`, issues: issuesA });
  }

  B.forEach((b, i) => {
    if (usedB.has(i)) return;
    const dtB = normalizeDate(b.invoiceDate);
    const dl = itcDeadline(dtB);
    const dlNote = dl
      ? (pastItcDeadline(dtB, today)
          ? ` ⚠ S.16(4) deadline (${dl}) has PASSED — ITC lapsed unless S.16(5)/(6) applies.`
          : ` Claim before ${dl} (S.16(4)).`)
      : "";
    out.push({ a: null, b, type: "UNMATCHED_B", notes: `In GSTR-2B but not booked — verify and record to claim ITC.${dlNote}`, issues: rowChecks(b) });
  });

  return out;
}

export const MATCH_LABELS = {
  PERFECT: "Perfect Match",
  FUZZY_INV: "Match (Invoice No. Format)",
  HIGH: "High Confidence (CN/DN)",
  MEDIUM_AMT: "Probable — Date Differs",
  HEAD_SWAP: "Wrong Tax Head (S.77)",
  MEDIUM_TAX: "Tax Amount Mismatch",
  LOW: "Weak Match",
  UNMATCHED_A: "Only in Books — ITC Blocked",
  UNMATCHED_B: "Only in Portal — Not Booked",
};
