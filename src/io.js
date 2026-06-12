import * as XLSX from "xlsx";
import { normalizeAmt, normalizeGST, MATCH_LABELS } from "./engine.js";

export const autoDetect = (cols) => {
  const norm = (s) => s.toLowerCase().replace(/[\s_\-./*#]/g, "");
  const find = (...kws) => {
    for (const kw of kws) {
      const k = norm(kw);
      const hit = cols.find((c) => {
        const cn = norm(String(c));
        return cn === k || cn.startsWith(k) || cn.includes(k);
      });
      if (hit) return hit;
    }
    return "";
  };
  return {
    gst: find("gstin", "gstno", "gstnumber", "gstofsupplier", "gstofrecipient", "suppliergst", "gst"),
    invoiceNo: find("invoiceno", "invoicenumber", "billno", "billnumber", "docno", "documentno", "voucherno", "noteno", "creditnoteno", "debitnoteno"),
    invoiceDate: find("invoicedate", "billdate", "documentdate", "voucherdate", "notedate", "date"),
    partyName: find("partyname", "suppliername", "tradename", "legalname", "customername", "vendorname", "receivername", "name"),
    taxableValue: find("taxablevalue", "taxableamount", "taxableamt", "baseamount", "taxable"),
    igst: find("igstamount", "igstamt", "integratedtax", "igst"),
    cgst: find("cgstamount", "cgstamt", "centraltax", "cgst"),
    sgst: find("sgstamount", "sgstamt", "statetax", "utgst", "sgst"),
    invoiceValue: find("invoicevalue", "totalinvoicevalue", "totalamount", "grossamount", "invoiceamt", "gross", "total"),
  };
};

export function buildSheet(name, rawRows, hdrIdx) {
  const raw = rawRows[hdrIdx] || [];
  const headers = raw.map((h, i) => (h !== "" ? String(h).trim() : `Column_${i + 1}`));
  const seen = {};
  const cols = headers.map((h) => {
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h}_${seen[h]}` : h;
  });
  const data = rawRows
    .slice(hdrIdx + 1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = r[i] !== undefined ? r[i] : ""; });
      return obj;
    });
  return { name, rawRows, hdrIdx, cols, data, rowCount: data.length, map: autoDetect(cols), selected: data.length > 0 };
}

export const parseWorkbook = (file) =>
  new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: false });
        const sheets = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
          const defaultHdr = rawRows.findIndex((r) => r.some((c) => c !== ""));
          return buildSheet(name, rawRows, defaultHdr < 0 ? 0 : defaultHdr);
        });
        res({ fileName: file.name, sheets });
      } catch (err) { rej(err); }
    };
    reader.onerror = rej;
    reader.readAsArrayBuffer(file);
  });

const safeGet = (row, col) => {
  if (!col || !row) return "";
  const v = row[col];
  return v === undefined || v === null ? "" : v;
};

export const extractRecs = (data, m, sheetName) =>
  data
    .map((row) => ({
      gst: String(safeGet(row, m.gst)).trim(),
      invoiceNo: String(safeGet(row, m.invoiceNo)).trim(),
      invoiceDate: safeGet(row, m.invoiceDate),
      partyName: String(safeGet(row, m.partyName)).trim(),
      taxableValue: safeGet(row, m.taxableValue),
      igst: safeGet(row, m.igst),
      cgst: safeGet(row, m.cgst),
      sgst: safeGet(row, m.sgst),
      invoiceValue: safeGet(row, m.invoiceValue),
      _sheet: sheetName,
    }))
    .filter(
      (r) =>
        r.gst || r.invoiceNo ||
        normalizeAmt(r.taxableValue) || normalizeAmt(r.igst) ||
        normalizeAmt(r.cgst) || normalizeAmt(r.sgst) || normalizeAmt(r.invoiceValue)
    );

export const diagnose = (pool, label) => {
  const n = pool.length;
  if (!n) return [`⛔ ${label}: 0 records extracted — column mapping is likely wrong`];
  const warns = [];
  const emptyGst = pool.filter((r) => !normalizeGST(r.gst)).length;
  const emptyInv = pool.filter((r) => !r.invoiceNo).length;
  const emptyTax = pool.filter((r) => !normalizeAmt(r.taxableValue)).length;
  if (emptyGst === n) warns.push(`⚠ ${label}: GSTIN is empty for ALL ${n} rows — check GSTIN column mapping`);
  else if (emptyGst > n * 0.3) warns.push(`⚠ ${label}: ${emptyGst}/${n} rows have empty GSTIN`);
  if (emptyInv === n) warns.push(`⚠ ${label}: Invoice No. is empty for ALL rows — check Invoice No. mapping`);
  if (emptyTax === n) warns.push(`⚠ ${label}: Taxable Value is 0 for ALL rows — check Taxable Value mapping`);
  return warns;
};

export function exportXLSX(results, lA, lB) {
  const fa = (v) => normalizeAmt(v) || "";
  const rows = results.map((r, i) => ({
    "#": i + 1,
    "Match Type": MATCH_LABELS[r.type] || r.type,
    [`[${lA}] Sheet`]: r.a?._sheet || "",
    [`[${lA}] GSTIN`]: r.a?.gst || "",
    [`[${lA}] Invoice No.`]: r.a?.invoiceNo || "",
    [`[${lA}] Date`]: r.a?.invoiceDate || "",
    [`[${lA}] Party`]: r.a?.partyName || "",
    [`[${lA}] Taxable`]: r.a ? fa(r.a.taxableValue) : "",
    [`[${lA}] IGST`]: r.a ? fa(r.a.igst) : "",
    [`[${lA}] CGST`]: r.a ? fa(r.a.cgst) : "",
    [`[${lA}] SGST`]: r.a ? fa(r.a.sgst) : "",
    [`[${lB}] Sheet`]: r.b?._sheet || "",
    [`[${lB}] GSTIN`]: r.b?.gst || "",
    [`[${lB}] Invoice No.`]: r.b?.invoiceNo || "",
    [`[${lB}] Date`]: r.b?.invoiceDate || "",
    [`[${lB}] Party`]: r.b?.partyName || "",
    [`[${lB}] Taxable`]: r.b ? fa(r.b.taxableValue) : "",
    [`[${lB}] IGST`]: r.b ? fa(r.b.igst) : "",
    [`[${lB}] CGST`]: r.b ? fa(r.b.cgst) : "",
    [`[${lB}] SGST`]: r.b ? fa(r.b.sgst) : "",
    "Δ Taxable": r.a && r.b ? +(normalizeAmt(r.b.taxableValue) - normalizeAmt(r.a.taxableValue)).toFixed(2) : "",
    "Δ IGST": r.a && r.b ? +(normalizeAmt(r.b.igst) - normalizeAmt(r.a.igst)).toFixed(2) : "",
    "Δ CGST": r.a && r.b ? +(normalizeAmt(r.b.cgst) - normalizeAmt(r.a.cgst)).toFixed(2) : "",
    "Δ SGST": r.a && r.b ? +(normalizeAmt(r.b.sgst) - normalizeAmt(r.a.sgst)).toFixed(2) : "",
    "Statutory Flags": (r.issues || []).join("; "),
    "Remarks": r.notes,
  }));
  const wb2 = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(k.length + 2, 14) }));
  XLSX.utils.book_append_sheet(wb2, ws, "Reconciliation");
  const sumRows = Object.entries(MATCH_LABELS).map(([t, l]) => {
    const recs = results.filter((r) => r.type === t);
    return {
      "Match Type": l,
      "Count": recs.length,
      [`Taxable (${lA})`]: recs.filter((r) => r.a).reduce((s, r) => s + normalizeAmt(r.a.taxableValue), 0).toFixed(2),
      [`Taxable (${lB})`]: recs.filter((r) => r.b).reduce((s, r) => s + normalizeAmt(r.b.taxableValue), 0).toFixed(2),
    };
  });
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(sumRows), "Summary");
  XLSX.writeFile(wb2, `GST_Recon_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
