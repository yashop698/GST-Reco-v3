import { useMemo, useState } from "react";
import { normalizeAmt, reconcile, findDuplicates, MATCH_LABELS } from "./engine.js";
import { parseWorkbook, buildSheet, extractRecs, diagnose, exportXLSX } from "./io.js";

// ═══════════════ CONSTANTS ═══════════════

const STD_FIELDS = [
  { key: "gst", label: "GSTIN / GST Number", required: true },
  { key: "invoiceNo", label: "Invoice / Document Number", required: true },
  { key: "invoiceDate", label: "Invoice Date", required: false },
  { key: "partyName", label: "Party / Trade Name", required: false },
  { key: "taxableValue", label: "Taxable Value", required: false },
  { key: "igst", label: "IGST Amount", required: false },
  { key: "cgst", label: "CGST Amount", required: false },
  { key: "sgst", label: "SGST / UTGST Amount", required: false },
  { key: "invoiceValue", label: "Invoice Value / Total", required: false },
];

const MATCH_CFG = {
  PERFECT: { label: "Perfect Match", bg: "#dcfce7", border: "#16a34a", text: "#14532d", dot: "#16a34a" },
  FUZZY_INV: { label: "Format Match", bg: "#dcfce7", border: "#15803d", text: "#14532d", dot: "#15803d" },
  HIGH: { label: "High Confidence", bg: "#d1fae5", border: "#059669", text: "#064e3b", dot: "#059669" },
  MEDIUM_AMT: { label: "Probable Match", bg: "#fef9c3", border: "#ca8a04", text: "#713f12", dot: "#ca8a04" },
  HEAD_SWAP: { label: "Wrong Tax Head", bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95", dot: "#7c3aed" },
  MEDIUM_TAX: { label: "Tax Mismatch", bg: "#ffedd5", border: "#d97706", text: "#7c2d12", dot: "#d97706" },
  LOW: { label: "Weak Match", bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d", dot: "#dc2626" },
  UNMATCHED_A: { label: "Only in Books", bg: "#fce7f3", border: "#db2777", text: "#831843", dot: "#db2777" },
  UNMATCHED_B: { label: "Only in Portal", bg: "#dbeafe", border: "#2563eb", text: "#1e3a8a", dot: "#2563eb" },
};

const PAGE_SIZE = 50;
const ACCENT_A = "#4f46e5";
const ACCENT_B = "#0d9488";

// ═══════════════ STYLES ═══════════════

const S = {
  app: { minHeight: "100vh", color: "var(--ink)", display: "flex", flexDirection: "column" },
  hdr: {
    background: "linear-gradient(120deg, #111827 0%, #1e293b 60%, #312e81 100%)",
    padding: "14px 26px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
  },
  ico: {
    width: 38, height: 38, background: "linear-gradient(135deg, #6366f1, #4338ca)", borderRadius: 10,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0,
    boxShadow: "0 4px 14px rgba(79,70,229,0.45)",
  },
  trust: {
    marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5,
    color: "#c7d2fe", background: "rgba(99,102,241,0.16)", border: "1px solid rgba(129,140,248,0.32)",
    padding: "5px 12px", borderRadius: 999, fontWeight: 500,
  },
  wrap: { maxWidth: 1480, margin: "0 auto", padding: "22px 18px 40px", width: "100%" },
  card: { background: "var(--surface)", borderRadius: "var(--r-md)", border: "1px solid var(--line)", padding: "20px 22px", marginBottom: 16, boxShadow: "var(--shadow-sm)" },
  lbl: { display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" },
  inp: { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--ink)", background: "#fff", outline: "none", boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s" },
  sel: { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--ink)", background: "#fff", outline: "none", cursor: "pointer", boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s" },
  btn: (bg, fg, ex = {}) => ({ padding: "9px 16px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: bg, color: fg, ...ex }),
  th: (bg = "#f8fafc") => ({ padding: "9px 9px", textAlign: "left", fontSize: 9.5, fontWeight: 700, color: "#475569", background: bg, borderBottom: "2px solid var(--line)", whiteSpace: "nowrap", letterSpacing: "0.05em", textTransform: "uppercase" }),
  td: (m = false) => ({ padding: "7px 9px", fontSize: 11.5, borderBottom: "1px solid var(--line-2)", color: m ? "#a3acbb" : "#334155", whiteSpace: "nowrap", fontStyle: m ? "italic" : "normal" }),
  tdNum: (m = false) => ({ padding: "7px 9px", fontSize: 11.5, borderBottom: "1px solid var(--line-2)", color: m ? "#a3acbb" : "#334155", whiteSpace: "nowrap", textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }),
  diffTd: (v) => { const n = parseFloat(v), c = Math.abs(n) < 2 ? "#16a34a" : "#dc2626"; return { padding: "7px 9px", fontSize: 11.5, borderBottom: "1px solid var(--line-2)", color: n === 0 ? "#a3acbb" : c, fontWeight: Math.abs(n) >= 2 ? 700 : 400, whiteSpace: "nowrap", textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }; },
  badge: (t) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: MATCH_CFG[t]?.bg, color: MATCH_CFG[t]?.text, border: `1px solid ${MATCH_CFG[t]?.border}`, whiteSpace: "nowrap" }),
};

const amtFmt = (v) => { const n = normalizeAmt(v); if (!n) return "—"; return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const cellStr = (v) => (v === null || v === undefined || v === "" ? "" : String(v).trim().slice(0, 30));

// ═══════════════ STEPPER ═══════════════

function Stepper({ stage }) {
  const steps = [
    { id: "setup", label: "Upload & Map" },
    { id: "preview", label: "Review Data" },
    { id: "results", label: "Reconcile" },
  ];
  const order = { setup: 0, preview: 1, results: 2 };
  const cur = order[stage] ?? 0;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
      {steps.map((st, i) => {
        const done = i < cur, active = i === cur;
        const dotBg = done ? "#16a34a" : active ? "var(--brand)" : "#e2e8f0";
        const dotFg = done || active ? "#fff" : "#94a3b8";
        return (
          <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span className="step-dot" style={{ width: 26, height: 26, borderRadius: 999, background: dotBg, color: dotFg, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: active ? "0 0 0 4px rgba(79,70,229,0.16)" : "none" }}>
                {done ? "✓" : i + 1}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "var(--ink)" : done ? "#16a34a" : "#94a3b8" }}>{st.label}</span>
            </div>
            {i < steps.length - 1 && <div style={{ width: 36, height: 2, background: i < cur ? "#16a34a" : "#e2e8f0", borderRadius: 2, margin: "0 4px" }} />}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════ FILE PANEL (upload + sheet + header + mapping) ═══════════════

function FilePanel({ side, label, accent, wb, setWb, setLabel }) {
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setWb(await parseWorkbook(file)); }
    catch (err) { alert(`Could not read ${file.name}: ${err.message || err}`); }
  };

  const updSheet = (si, patch) =>
    setWb({ ...wb, sheets: wb.sheets.map((s, i) => (i === si ? { ...s, ...patch } : s)) });

  const reHeader = (si, hdrIdx) => {
    const s = wb.sheets[si];
    updSheet(si, buildSheet(s.name, s.rawRows, hdrIdx));
  };

  return (
    <div className="card-hover" style={{ ...S.card, flex: 1, minWidth: 400, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: accent, color: "#fff", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{side}</div>
        <div style={{ flex: 1 }}>
          <label style={{ ...S.lbl, marginBottom: 3 }}>Dataset name</label>
          <input className="field" style={{ ...S.inp, maxWidth: 240, padding: "6px 10px", fontSize: 12.5 }} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {wb && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "4px 9px", borderRadius: 999, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {wb.fileName}</span>}
      </div>

      <label className="dropzone">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
        <div style={{ fontSize: 26, lineHeight: 1 }}>{wb ? "🔄" : "📑"}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
          {wb ? "Replace file" : "Click to upload Excel / CSV"}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-2)" }}>.xlsx · .xls · .csv — multi-sheet workbooks supported</div>
      </label>

      {wb && <div style={{ ...S.lbl, marginTop: 14, marginBottom: 8 }}>Sheets & column mapping</div>}
      {wb && wb.sheets.map((s, si) => (
        <div key={si} style={{ border: `1px solid ${s.selected ? "#dbe1ea" : "var(--line)"}`, borderRadius: "var(--r-sm)", padding: "11px 13px", marginBottom: 10, background: s.selected ? "#fff" : "#f8fafc", opacity: s.selected ? 1 : 0.7, transition: "opacity .15s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: s.selected ? 10 : 0 }}>
            <input type="checkbox" checked={s.selected} onChange={(e) => updSheet(si, { selected: e.target.checked })} style={{ width: 15, height: 15, accentColor: accent, cursor: "pointer" }} />
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</span>
            <span style={{ fontSize: 10.5, color: "var(--muted)", background: "#f1f5f9", padding: "2px 7px", borderRadius: 999 }}>{s.rowCount.toLocaleString()} rows</span>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Header row
              <select className="field" style={{ ...S.sel, width: 64, display: "inline-block", padding: "4px 6px", fontSize: 11.5 }} value={s.hdrIdx}
                onChange={(e) => reHeader(si, +e.target.value)}>
                {s.rawRows.slice(0, 15).map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </select>
            </span>
          </div>
          {s.selected && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 9 }}>
              {STD_FIELDS.map((f) => (
                <div key={f.key}>
                  <label style={S.lbl}>{f.label}{f.required && <span style={{ color: "#dc2626" }}> ★</span>}</label>
                  <select className="field" style={{ ...S.sel, fontSize: 12, padding: "7px 9px", borderColor: f.required && !s.map[f.key] ? "#fca5a5" : "#cbd5e1" }} value={s.map[f.key] || ""}
                    onChange={(e) => updSheet(si, { map: { ...s.map, [f.key]: e.target.value } })}>
                    <option value="">— not mapped —</option>
                    {s.cols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════ DATA PREVIEW MODAL ═══════════════

function PreviewModal({ poolA, poolB, lA, lB, warnings, onConfirm, onBack }) {
  const fields = ["gst", "invoiceNo", "invoiceDate", "partyName", "taxableValue", "igst", "cgst", "sgst"];
  const labels = ["GSTIN", "Invoice No.", "Date", "Party", "Taxable", "IGST", "CGST", "SGST"];

  const PreviewTable = ({ pool, label, accent }) => (
    <div style={{ flex: 1, minWidth: 300 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: accent, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{label[0]}</div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</div>
        <span style={{ fontSize: 11, color: pool.length > 0 ? "#15803d" : "#dc2626", fontWeight: 700, marginLeft: "auto", background: pool.length > 0 ? "#f0fdf4" : "#fef2f2", border: `1px solid ${pool.length > 0 ? "#bbf7d0" : "#fecaca"}`, padding: "3px 9px", borderRadius: 999 }}>
          {pool.length.toLocaleString()} records
        </span>
      </div>
      {pool.length === 0 ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--r-sm)", padding: "14px 16px", fontSize: 12.5, color: "#991b1b", lineHeight: 1.6 }}>
          <b>⛔ No records extracted.</b> Go back and check: (1) the correct header row is selected, (2) GSTIN ★ and Invoice No. ★ are mapped, (3) the correct sheet is selected.
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th(), width: 24 }}>#</th>
                <th style={S.th("#fffbeb")}>Sheet</th>
                {labels.map((l) => <th key={l} style={S.th()}>{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {pool.slice(0, 8).map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? "#fafbfc" : "#fff" }}>
                  <td style={{ ...S.td(true), width: 24, fontSize: 9 }}>{i + 1}</td>
                  <td style={{ ...S.td(false), fontSize: 9.5, color: accent, fontWeight: 600 }}>{r._sheet || ""}</td>
                  {fields.map((f) => {
                    const isNum = f === "taxableValue" || f === "igst" || f === "cgst" || f === "sgst";
                    return (
                      <td key={f} style={{ ...(isNum ? S.tdNum(!r[f]) : S.td(!r[f])), fontSize: 10.5, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {cellStr(isNum ? (normalizeAmt(r[f]) || "—") : (r[f] || "—"))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {pool.length > 8 && <div style={{ padding: "7px 11px", fontSize: 10.5, color: "var(--muted-2)", borderTop: "1px solid var(--line-2)", background: "#fafbfc" }}>…and {(pool.length - 8).toLocaleString()} more rows</div>}
        </div>
      )}
    </div>
  );

  return (
    <div className="overlay-in" style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
      <div className="modal-in" style={{ background: "#fff", borderRadius: "var(--r-lg)", width: "100%", maxWidth: 1100, maxHeight: "90vh", overflow: "auto", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
          <span style={{ fontSize: 22 }}>🔍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Review extracted data</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Confirm the right columns were picked up from each side before running. If anything looks off, go back and fix the mapping.</div>
          </div>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {warnings.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--r-sm)", padding: "13px 15px", marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 11.5, color: "#78350f", marginBottom: 7 }}>⚠ Issues detected — please review:</div>
              {warnings.map((w, i) => <div key={i} style={{ fontSize: 11.5, color: "#92400e", marginBottom: 3, lineHeight: 1.5 }}>• {w}</div>)}
            </div>
          )}

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <PreviewTable pool={poolA} label={lA} accent={ACCENT_A} />
            <PreviewTable pool={poolB} label={lB} accent={ACCENT_B} />
          </div>
        </div>

        <div style={{ padding: "15px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 10, position: "sticky", bottom: 0, background: "#fff" }}>
          <button className="btn" style={S.btn("#f1f5f9", "#334155", { border: "1px solid #e2e8f0" })} onClick={onBack}>← Back to mapping</button>
          <button className="btn btn-primary" style={S.btn("var(--brand)", "#fff", { opacity: !poolA.length || !poolB.length ? 0.5 : 1 })} disabled={!poolA.length || !poolB.length}
            onClick={onConfirm}>Run Reconciliation →</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════ RESULTS ═══════════════

function Results({ results, lA, lB, dupsA, dupsB, onReset }) {
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let r = filter === "ALL" ? results : results.filter((x) => x.type === filter);
    if (q.trim()) {
      const k = q.trim().toUpperCase();
      r = r.filter((x) =>
        [x.a?.gst, x.a?.invoiceNo, x.a?.partyName, x.b?.gst, x.b?.invoiceNo, x.b?.partyName]
          .some((v) => (v || "").toString().toUpperCase().includes(k)));
    }
    return r;
  }, [results, filter, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const view = filtered.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);

  const counts = useMemo(() => {
    const c = {};
    results.forEach((r) => { c[r.type] = (c[r.type] || 0) + 1; });
    return c;
  }, [results]);

  const itcBlocked = useMemo(() =>
    results.filter((r) => r.type === "UNMATCHED_A")
      .reduce((s, r) => s + normalizeAmt(r.a?.igst) + normalizeAmt(r.a?.cgst) + normalizeAmt(r.a?.sgst), 0),
    [results]);

  return (
    <div className="fade-up">
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 11, marginBottom: 16 }}>
        <div className="stat-card" style={{ background: filter === "ALL" ? "var(--brand)" : "var(--surface)", borderRadius: "var(--r-md)", border: filter === "ALL" ? "2px solid var(--brand)" : "1px solid var(--line)", padding: "13px 16px", cursor: "pointer", boxShadow: "var(--shadow-sm)" }}
          onClick={() => { setFilter("ALL"); setPage(0); }}>
          <div style={{ ...S.lbl, color: filter === "ALL" ? "#c7d2fe" : "var(--muted)" }}>All Records</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: filter === "ALL" ? "#fff" : "var(--ink)" }}>{results.length.toLocaleString()}</div>
        </div>
        {Object.entries(MATCH_CFG).map(([t, cfg]) => {
          const on = filter === t;
          return (
            <div key={t} className="stat-card" style={{ background: cfg.bg, borderRadius: "var(--r-md)", padding: "13px 16px", cursor: "pointer", border: on ? `2px solid ${cfg.border}` : "1px solid transparent", boxShadow: on ? `0 4px 14px ${cfg.border}33` : "var(--shadow-sm)" }}
              onClick={() => { setFilter(t); setPage(0); }}>
              <div style={{ ...S.lbl, color: cfg.text, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: cfg.dot, flexShrink: 0 }} />{cfg.label}
              </div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: cfg.text }}>{(counts[t] || 0).toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      {/* Statutory banner */}
      <div style={{ ...S.card, background: "linear-gradient(90deg,#fff7ed,#fffbeb)", border: "1px solid #fed7aa", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontSize: 18, lineHeight: 1.2 }}>⚠️</span>
        <div style={{ fontSize: 12, color: "#7c2d12", lineHeight: 1.6 }}>
          <b>ITC at risk (S.16(2)(aa) / Rule 36(4)):</b> ₹{itcBlocked.toLocaleString("en-IN", { minimumFractionDigits: 2 })} of tax sits on invoices in your books that are absent from GSTR-2B — this credit is not available until suppliers report those invoices.
          {dupsA.length > 0 && <> &nbsp;<b>Duplicates in {lA}:</b> {dupsA.length} (double-claim risk, S.73/74).</>}
          {dupsB.length > 0 && <> &nbsp;<b>Duplicates in {lB}:</b> {dupsB.length}.</>}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 340 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
          <input className="field" style={{ ...S.inp, paddingLeft: 32 }} placeholder="Search GSTIN / invoice / party…" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}><b style={{ color: "var(--ink-2)" }}>{filtered.length.toLocaleString()}</b> rows shown</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
          <button className="btn" style={S.btn("#16a34a", "#fff")} onClick={() => exportXLSX(results, lA, lB)}>⬇ Export XLSX</button>
          <button className="btn" style={S.btn("#f1f5f9", "#334155", { border: "1px solid #e2e8f0" })} onClick={onReset}>↺ New Reconciliation</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ ...S.card, padding: 0, overflowX: "auto", maxHeight: "70vh", overflowY: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th()}>#</th>
              <th style={S.th()}>Match</th>
              <th style={S.th("#eef2ff")}>[{lA}] GSTIN</th>
              <th style={S.th("#eef2ff")}>Inv No.</th>
              <th style={S.th("#eef2ff")}>Date</th>
              <th style={S.th("#eef2ff")}>Taxable</th>
              <th style={S.th("#eef2ff")}>IGST</th>
              <th style={S.th("#eef2ff")}>CGST</th>
              <th style={S.th("#eef2ff")}>SGST</th>
              <th style={S.th("#f0fdfa")}>[{lB}] GSTIN</th>
              <th style={S.th("#f0fdfa")}>Inv No.</th>
              <th style={S.th("#f0fdfa")}>Date</th>
              <th style={S.th("#f0fdfa")}>Taxable</th>
              <th style={S.th("#f0fdfa")}>IGST</th>
              <th style={S.th("#f0fdfa")}>CGST</th>
              <th style={S.th("#f0fdfa")}>SGST</th>
              <th style={S.th()}>Δ Taxable</th>
              <th style={S.th()}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => {
              const dT = r.a && r.b ? (normalizeAmt(r.b.taxableValue) - normalizeAmt(r.a.taxableValue)).toFixed(2) : "";
              return (
                <tr key={i} style={{ background: i % 2 ? "#fafbfc" : "#fff" }}>
                  <td style={S.td(true)}>{pg * PAGE_SIZE + i + 1}</td>
                  <td style={S.td()}><span style={S.badge(r.type)}><span style={{ width: 6, height: 6, borderRadius: 999, background: MATCH_CFG[r.type]?.dot }} />{MATCH_CFG[r.type]?.label}</span></td>
                  <td style={{ ...S.td(!r.a), fontFamily: "var(--font-mono)" }}>{cellStr(r.a?.gst) || "—"}</td>
                  <td style={{ ...S.td(!r.a), fontFamily: "var(--font-mono)" }}>{cellStr(r.a?.invoiceNo) || "—"}</td>
                  <td style={S.td(!r.a)}>{cellStr(r.a?.invoiceDate) || "—"}</td>
                  <td style={S.tdNum(!r.a)}>{r.a ? amtFmt(r.a.taxableValue) : "—"}</td>
                  <td style={S.tdNum(!r.a)}>{r.a ? amtFmt(r.a.igst) : "—"}</td>
                  <td style={S.tdNum(!r.a)}>{r.a ? amtFmt(r.a.cgst) : "—"}</td>
                  <td style={S.tdNum(!r.a)}>{r.a ? amtFmt(r.a.sgst) : "—"}</td>
                  <td style={{ ...S.td(!r.b), fontFamily: "var(--font-mono)" }}>{cellStr(r.b?.gst) || "—"}</td>
                  <td style={{ ...S.td(!r.b), fontFamily: "var(--font-mono)" }}>{cellStr(r.b?.invoiceNo) || "—"}</td>
                  <td style={S.td(!r.b)}>{cellStr(r.b?.invoiceDate) || "—"}</td>
                  <td style={S.tdNum(!r.b)}>{r.b ? amtFmt(r.b.taxableValue) : "—"}</td>
                  <td style={S.tdNum(!r.b)}>{r.b ? amtFmt(r.b.igst) : "—"}</td>
                  <td style={S.tdNum(!r.b)}>{r.b ? amtFmt(r.b.cgst) : "—"}</td>
                  <td style={S.tdNum(!r.b)}>{r.b ? amtFmt(r.b.sgst) : "—"}</td>
                  <td style={dT !== "" ? S.diffTd(dT) : S.tdNum(true)}>{dT || "—"}</td>
                  <td style={{ ...S.td(), whiteSpace: "normal", minWidth: 260, fontSize: 10.5, lineHeight: 1.5 }}>
                    {r.notes}
                    {r.issues?.length > 0 && <div style={{ color: "#b91c1c", marginTop: 2 }}>{r.issues.join(" · ")}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {view.length === 0 && <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted-2)", fontSize: 13 }}>No records match the current filter.</div>}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 14 }}>
          <button className="btn" style={S.btn("#f1f5f9", "#334155", { border: "1px solid #e2e8f0", opacity: pg === 0 ? 0.5 : 1 })} disabled={pg === 0} onClick={() => setPage(pg - 1)}>← Prev</button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Page <b style={{ color: "var(--ink-2)" }}>{pg + 1}</b> of {pages}</span>
          <button className="btn" style={S.btn("#f1f5f9", "#334155", { border: "1px solid #e2e8f0", opacity: pg >= pages - 1 ? 0.5 : 1 })} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════ APP ═══════════════

export default function App() {
  const [wbA, setWbA] = useState(null);
  const [wbB, setWbB] = useState(null);
  const [lA, setLA] = useState("Books");
  const [lB, setLB] = useState("GSTR-2B Portal");
  const [stage, setStage] = useState("setup"); // setup | preview | results
  const [pools, setPools] = useState(null);
  const [results, setResults] = useState(null);

  const buildPools = () => {
    const pool = (wb) =>
      (wb?.sheets || [])
        .filter((s) => s.selected)
        .flatMap((s) => extractRecs(s.data, s.map, s.name));
    const poolA = pool(wbA);
    const poolB = pool(wbB);
    setPools({ poolA, poolB, warnings: [...diagnose(poolA, lA), ...diagnose(poolB, lB)] });
    setStage("preview");
  };

  const run = () => {
    setResults(reconcile(pools.poolA, pools.poolB));
    setStage("results");
  };

  const reset = () => { setStage("setup"); setResults(null); setPools(null); };

  return (
    <div style={S.app}>
      <header style={S.hdr}>
        <div style={S.ico}>⚖</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>GST Reconciliation Tool</div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 1 }}>Books vs GSTR-2B · S.16(2)(aa) · Rule 36(4) · S.16(4) · S.77 aware</div>
        </div>
        <span style={S.trust}>🔒 Runs in your browser — no data leaves your device</span>
      </header>

      <main style={S.wrap}>
        <Stepper stage={stage} />

        {stage !== "results" && (
          <div className="fade-up">
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <FilePanel side="A" label={lA} accent={ACCENT_A} wb={wbA} setWb={setWbA} setLabel={setLA} />
              <FilePanel side="B" label={lB} accent={ACCENT_B} wb={wbB} setWb={setWbB} setLabel={setLB} />
            </div>
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <button className="btn btn-primary" style={S.btn("var(--brand)", "#fff", { padding: "13px 38px", fontSize: 14.5, borderRadius: "var(--r-md)", opacity: wbA && wbB ? 1 : 0.45, boxShadow: wbA && wbB ? "0 8px 22px rgba(79,70,229,0.32)" : "none" })}
                disabled={!wbA || !wbB} onClick={buildPools}>
                Preview & Reconcile →
              </button>
              {(!wbA || !wbB) && <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 9 }}>Upload both files to continue.</div>}
            </div>
          </div>
        )}

        {stage === "preview" && pools && (
          <PreviewModal poolA={pools.poolA} poolB={pools.poolB} lA={lA} lB={lB}
            warnings={pools.warnings} onConfirm={run} onBack={() => setStage("setup")} />
        )}

        {stage === "results" && results && (
          <Results results={results} lA={lA} lB={lB}
            dupsA={findDuplicates(pools.poolA)} dupsB={findDuplicates(pools.poolB)} onReset={reset} />
        )}
      </main>

      <footer style={{ marginTop: "auto", borderTop: "1px solid var(--line)", background: "#fff", padding: "16px 26px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--muted-2)", maxWidth: 760, margin: "0 auto", lineHeight: 1.6 }}>
          Assists reconciliation; not legal advice. Verify statutory positions against current CBIC notifications before filing.
          All processing happens locally in your browser.
        </div>
      </footer>
    </div>
  );
}
