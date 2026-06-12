# GST Reconciliation Tool

Browser-based reconciliation of purchase register (books) against GSTR-2B portal data. Everything runs client-side — no data leaves your machine.

## Run

```bash
npm install
npm run dev      # local dev server
npm test         # engine unit tests
npm run build    # production build in dist/
```

## How it works

1. Upload two Excel/CSV files (Books and GSTR-2B export). Multi-sheet workbooks supported.
2. Pick the header row per sheet; columns are auto-detected and can be remapped.
3. Preview extracted records, then run reconciliation.
4. Filter by match type, search, and export the full result to XLSX (with a summary sheet).

## Matching tiers

| Tier | Criteria |
|---|---|
| Perfect | GSTIN + invoice no. + all tax amounts |
| Format Match | Same, but invoice nos. differ only in case/zeros/special chars (GSTN formatting noise) |
| High (CN/DN) | GSTIN + amounts + date; invoice nos. differ — likely credit/debit note (S.34) |
| Probable | GSTIN + amounts; date differs (period shift or amendment) |
| Wrong Tax Head | Taxable + total tax equal but IGST ↔ CGST+SGST swapped (S.77 CGST / S.19 IGST) |
| Tax Mismatch | GSTIN + taxable + date; tax amounts differ — ITC capped at GSTR-2B figure |
| Weak | GSTIN + invoice total only |
| Only in Books | Not in GSTR-2B — ITC **not available** per S.16(2)(aa) / Rule 36(4) |
| Only in Portal | In GSTR-2B but unbooked — claim before the S.16(4) deadline |

## CGST Act, 2017 logic built in

- **S.16(2)(aa) + Rule 36(4):** invoices absent from GSTR-2B are flagged as ITC-blocked, with the blocked tax amount totalled on the results screen.
- **S.16(4):** ITC deadline (30 November following the financial year of the invoice) computed per record; lapsed credit is flagged (with a pointer to S.16(5)/(6) relief).
- **S.77 CGST / S.19 IGST:** wrong-head detection — IGST charged on one side, CGST+SGST on the other.
- **S.34:** credit/debit notes matched on absolute amounts so sign conventions don't break matching.
- **S.170:** per-head ₹1 rounding tolerance.
- **GSTIN validation:** 15-character structure + MOD-36 check digit.
- **Row sanity checks:** CGST must equal SGST; IGST and CGST/SGST can't coexist on one document; effective rate must be a notified GST rate.
- **Duplicate detection:** same GSTIN + invoice no. booked twice (excess-claim exposure under S.73/74).

## Disclaimer

Assists reconciliation; it is not legal advice. Verify statutory positions against current CBIC notifications before filing.
