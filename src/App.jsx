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

// ═══════════════ STYLES ═══════════════

const S = {
  app: { fontFamily: "'IBM Plex Mono','Consolas',monospace", background: "#f1f5f9", minHeight: "100vh", color: "#0f172a" },
  hdr: { background: "#0f172a", padding: "13px 24px", display: "flex", alignItems: "center", gap: 12 },
  ico: { width: 32, height: 32, background: "#1d4ed8", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 },
  wrap: { maxWidth: 1440, margin: "0 auto", padding: "20px 18px" },
  card: { background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "18px 20px", marginBottom: 14 },
  lbl: { display: "block", fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 4, letterSpacing: "0.07em", textTransform: "uppercase" },
  inp: { width: "100%", padding: "7px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, color: "#0f172a", background: "#f8fafc", outline: "none", boxSizing: "border-box" },
  sel: { width: "100%", padding: "7px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, color: "#0f172a", background: "#fff", outline: "none", cursor: "pointer", boxSizing: "border-box" },
  btn: (bg, fg, ex = {}) => ({ padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: bg, color: fg, ...ex }),
  th: (bg = "#f1f5f9") => ({ padding: "7px 8px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "#475569", background: bg, borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", letterSpacing: "0.06em", textTransform: "uppercase" }),
  td: (m = false) => ({ padding: "5px 8px", fontSize: 11, borderBottom: "1px solid #f1f5f9", color: m ? "#94a3b8" : "#334155", whiteSpace: "nowrap", fontStyle: m ? "italic" : "normal" }),
  diffTd: (v) => { const n = parseFloat(v), c = Math.abs(n) < 2 ? "#16a34a" : "#dc2626"; return { padding: "5px 8px", fontSize: 11, borderBottom: "1px solid #f1f5f9", color: n === 0 ? "#94a3b8" : c, fontWeight: Math.abs(n) >= 2 ? 700 : 400, whiteSpace: "nowrap", textAlign: "right" }; },
  badge: (t) => ({ display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: MATCH_CFG[t]?.bg, color: MATCH_CFG[t]?.text, border: `1px solid ${MATCH_CFG[t]?.border}`, whiteSpace: "nowrap" }),
};

const amtFmt = (v) => { const n = normalizeAmt(v); if (!n) return "—"; return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const cellStr = (v) => (v === null || v === undefined || v === "" ? "" : String(v).trim().slice(0, 30));

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
    <div style={{ ...S.card, flex: 1, minWidth: 380 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 5, background: accent, color: "#fff", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{side}</div>
        <input style={{ ...S.inp, maxWidth: 220 }} value={label} onChange={(e) => setLabel(e.target.value)} />
        {wb && <span style={{ marginLeft: "auto", fontSize: 10, color: "#64748b" }}>{wb.fileName}</span>}
      </div>

      <label style={S.lbl}>Upload Excel / CSV</label>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ fontSize: 11, marginBottom: 12 }} />

      {wb && wb.sheets.map((s, si) => (
        <div key={si} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 10, background: s.selected ? "#fff" : "#f8fafc", opacity: s.selected ? 1 : 0.65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input type="checkbox" checked={s.selected} onChange={(e) => updSheet(si, { selected: e.target.checked })} />
            <span style={{ fontWeight: 700, fontSize: 12 }}>{s.name}</span>
            <span style={{ fontSize: 10, color: "#64748b" }}>{s.rowCount.toLocaleString()} rows</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#64748b" }}>
              Header row:{" "}
              <select style={{ ...S.sel, width: 70, display: "inline-block", padding: "3px 6px" }} value={s.hdrIdx}
                onChange={(e) => reHeader(si, +e.target.value)}>
                {s.rawRows.slice(0, 15).map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </select>
            </span>
          </div>
          {s.selected && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {STD_FIELDS.map((f) => (
                <div key={f.key}>
                  <label style={S.lbl}>{f.label}{f.required && <span style={{ color: "#dc2626" }}> ★</span>}</label>
                  <select style={S.sel} value={s.map[f.key] || ""}
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
        <div style={{ width: 22, height: 22, borderRadius: 4, background: accent, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{label[0]}</div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
        <span style={{ fontSize: 11, color: pool.length > 0 ? "#16a34a" : "#dc2626", fontWeight: 700, marginLeft: "auto" }}>
          {pool.length.toLocaleString()} records extracted
        </span>
      </div>
      {pool.length === 0 ? (
        <div style={{ background: "#fee2e2", borderRadius: 8, padding: "14px 16px", fontSize: 12, color: "#7f1d1d" }}>
          ⛔ No records extracted. Go back and check: (1) correct header row selected, (2) GSTIN ★ and Invoice No. ★ are mapped, (3) the correct sheet is selected.
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
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
                <tr key={i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                  <td style={{ ...S.td(true), width: 24, fontSize: 9 }}>{i + 1}</td>
                  <td style={{ ...S.td(false), fontSize: 9, color: accent, fontWeight: 600 }}>{r._sheet || ""}</td>
                  {fields.map((f) => (
                    <td key={f} style={{ ...S.td(!r[f]), fontSize: 10, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {cellStr(f === "taxableValue" || f === "igst" || f === "cgst" || f === "sgst"
                        ? (normalizeAmt(r[f]) || "—")
                        : (r[f] || "—"))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {pool.length > 8 && <div style={{ padding: "6px 10px", fontSize: 10, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>...and {pool.length - 8} more rows</div>}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 1100, maxHeight: "90vh", overflow: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Data Preview — verify before running</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Check that the right data is being extracted from each side. If something looks wrong, go back and fix the column mapping.</div>
          </div>
        </div>

        <div style={{ padding: "18px 22px" }}>
          {warnings.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: "#78350f", marginBottom: 6 }}>⚠ Issues detected — please review:</div>
              {warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: "#92400e", marginBottom: 3 }}>• {w}</div>)}
            </div>
          )}

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <PreviewTable pool={poolA} label={lA} accent="#1d4ed8" />
            <PreviewTable pool={poolB} label={lB} accent="#0891b2" />
          </div>
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button style={S.btn("#e2e8f0", "#334155")} onClick={onBack}>← Back to mapping</button>
          <button style={S.btn("#1d4ed8", "#fff")} disabled={!poolA.length || !poolB.length}
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
    <>
      {/* Summary cards */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ ...S.card, marginBottom: 0, padding: "12px 16px", minWidth: 150, cursor: "pointer", border: filter === "ALL" ? "2px solid #1d4ed8" : "1px solid #e2e8f0" }}
          onClick={() => { setFilter("ALL"); setPage(0); }}>
          <div style={S.lbl}>All Records</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{results.length.toLocaleString()}</div>
        </div>
        {Object.entries(MATCH_CFG).map(([t, cfg]) => (
          <div key={t} style={{ ...S.card, marginBottom: 0, padding: "12px 16px", minWidth: 130, cursor: "pointer", background: cfg.bg, border: filter === t ? `2px solid ${cfg.border}` : "1px solid #e2e8f0" }}
            onClick={() => { setFilter(t); setPage(0); }}>
            <div style={{ ...S.lbl, color: cfg.text }}>{cfg.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: cfg.text }}>{(counts[t] || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Statutory banner */}
      <div style={{ ...S.card, background: "#fff7ed", border: "1px solid #fed7aa" }}>
        <div style={{ fontSize: 11, color: "#7c2d12" }}>
          <b>ITC at risk (S.16(2)(aa) / Rule 36(4)):</b> ₹{itcBlocked.toLocaleString("en-IN", { minimumFractionDigits: 2 })} of tax sits on invoices in your books that are absent from GSTR-2B — this credit is not available until suppliers report those invoices.
          {dupsA.length > 0 && <> &nbsp;<b>Duplicates in {lA}:</b> {dupsA.length} (double-claim risk, S.73/74).</>}
          {dupsB.length > 0 && <> &nbsp;<b>Duplicates in {lB}:</b> {dupsB.length}.</>}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <input style={{ ...S.inp, maxWidth: 320 }} placeholder="Search GSTIN / invoice / party…" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <span style={{ fontSize: 11, color: "#64748b" }}>{filtered.length.toLocaleString()} rows</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button style={S.btn("#16a34a", "#fff")} onClick={() => exportXLSX(results, lA, lB)}>⬇ Export XLSX</button>
          <button style={S.btn("#e2e8f0", "#334155")} onClick={onReset}>↺ New Reconciliation</button>
        </div>
      </div>

      {/* Table */}
      <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th()}>#</th>
              <th style={S.th()}>Match</th>
              <th style={S.th("#eff6ff")}>[{lA}] GSTIN</th>
              <th style={S.th("#eff6ff")}>Inv No.</th>
              <th style={S.th("#eff6ff")}>Date</th>
              <th style={S.th("#eff6ff")}>Taxable</th>
              <th style={S.th("#eff6ff")}>IGST</th>
              <th style={S.th("#eff6ff")}>CGST</th>
              <th style={S.th("#eff6ff")}>SGST</th>
              <th style={S.th("#ecfeff")}>[{lB}] GSTIN</th>
              <th style={S.th("#ecfeff")}>Inv No.</th>
              <th style={S.th("#ecfeff")}>Date</th>
              <th style={S.th("#ecfeff")}>Taxable</th>
              <th style={S.th("#ecfeff")}>IGST</th>
              <th style={S.th("#ecfeff")}>CGST</th>
              <th style={S.th("#ecfeff")}>SGST</th>
              <th style={S.th()}>Δ Taxable</th>
              <th style={S.th()}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => {
              const dT = r.a && r.b ? (normalizeAmt(r.b.taxableValue) - normalizeAmt(r.a.taxableValue)).toFixed(2) : "";
              return (
                <tr key={i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                  <td style={S.td(true)}>{pg * PAGE_SIZE + i + 1}</td>
                  <td style={S.td()}><span style={S.badge(r.type)}>● {MATCH_CFG[r.type]?.label}</span></td>
                  <td style={S.td(!r.a)}>{cellStr(r.a?.gst) || "—"}</td>
                  <td style={S.td(!r.a)}>{cellStr(r.a?.invoiceNo) || "—"}</td>
                  <td style={S.td(!r.a)}>{cellStr(r.a?.invoiceDate) || "—"}</td>
                  <td style={{ ...S.td(!r.a), textAlign: "right" }}>{r.a ? amtFmt(r.a.taxableValue) : "—"}</td>
                  <td style={{ ...S.td(!r.a), textAlign: "right" }}>{r.a ? amtFmt(r.a.igst) : "—"}</td>
                  <td style={{ ...S.td(!r.a), textAlign: "right" }}>{r.a ? amtFmt(r.a.cgst) : "—"}</td>
                  <td style={{ ...S.td(!r.a), textAlign: "right" }}>{r.a ? amtFmt(r.a.sgst) : "—"}</td>
                  <td style={S.td(!r.b)}>{cellStr(r.b?.gst) || "—"}</td>
                  <td style={S.td(!r.b)}>{cellStr(r.b?.invoiceNo) || "—"}</td>
                  <td style={S.td(!r.b)}>{cellStr(r.b?.invoiceDate) || "—"}</td>
                  <td style={{ ...S.td(!r.b), textAlign: "right" }}>{r.b ? amtFmt(r.b.taxableValue) : "—"}</td>
                  <td style={{ ...S.td(!r.b), textAlign: "right" }}>{r.b ? amtFmt(r.b.igst) : "—"}</td>
                  <td style={{ ...S.td(!r.b), textAlign: "right" }}>{r.b ? amtFmt(r.b.cgst) : "—"}</td>
                  <td style={{ ...S.td(!r.b), textAlign: "right" }}>{r.b ? amtFmt(r.b.sgst) : "—"}</td>
                  <td style={dT !== "" ? S.diffTd(dT) : S.td(true)}>{dT || "—"}</td>
                  <td style={{ ...S.td(), whiteSpace: "normal", minWidth: 260, fontSize: 10 }}>
                    {r.notes}
                    {r.issues?.length > 0 && <div style={{ color: "#b91c1c", marginTop: 2 }}>{r.issues.join(" · ")}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 4 }}>
          <button style={S.btn("#e2e8f0", "#334155")} disabled={pg === 0} onClick={() => setPage(pg - 1)}>← Prev</button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {pg + 1} / {pages}</span>
          <button style={S.btn("#e2e8f0", "#334155")} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next →</button>
        </div>
      )}
    </>
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
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>GST Reconciliation Tool</div>
          <div style={{ color: "#94a3b8", fontSize: 10 }}>Books vs GSTR-2B · S.16(2)(aa) · Rule 36(4) · S.16(4) · S.77 aware</div>
        </div>
      </header>

      <main style={S.wrap}>
        {stage !== "results" && (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <FilePanel side="A" label={lA} accent="#1d4ed8" wb={wbA} setWb={setWbA} setLabel={setLA} />
              <FilePanel side="B" label={lB} accent="#0891b2" wb={wbB} setWb={setWbB} setLabel={setLB} />
            </div>
            <div style={{ textAlign: "center", marginTop: 6 }}>
              <button style={S.btn("#1d4ed8", "#fff", { padding: "12px 34px", fontSize: 14, opacity: wbA && wbB ? 1 : 0.45 })}
                disabled={!wbA || !wbB} onClick={buildPools}>
                Preview & Reconcile →
              </button>
              {(!wbA || !wbB) && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Upload both files to continue.</div>}
            </div>
          </>
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
    </div>
  );
}
