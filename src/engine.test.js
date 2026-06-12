import { describe, it, expect } from "vitest";
import {
  normalizeDate, normalizeAmt, isValidGSTIN, gstinCheckDigit,
  itcDeadline, pastItcDeadline, rateLooksValid, fuzzyInv,
  rowChecks, findDuplicates, reconcile,
} from "./engine.js";

const rec = (o) => ({
  gst: "27AAPFU0939F1ZV", invoiceNo: "INV-001", invoiceDate: "2025-05-10",
  partyName: "Test", taxableValue: 1000, igst: 0, cgst: 90, sgst: 90,
  invoiceValue: 1180, ...o,
});

describe("normalizeDate", () => {
  it("parses dd/mm/yyyy", () => expect(normalizeDate("10/05/2025")).toBe("2025-05-10"));
  it("parses dd-mm-yy", () => expect(normalizeDate("10-05-25")).toBe("2025-05-10"));
  it("parses Excel serial", () => expect(normalizeDate(45788)).toBe("2025-05-11"));
  it("passes ISO through", () => expect(normalizeDate("2025-05-10T00:00")).toBe("2025-05-10"));
});

describe("GSTIN validation", () => {
  it("accepts a valid GSTIN", () => expect(isValidGSTIN("27AAPFU0939F1ZV")).toBe(true));
  it("rejects wrong check digit", () => expect(isValidGSTIN("27AAPFU0939F1ZA")).toBe(false));
  it("rejects wrong length", () => expect(isValidGSTIN("27AAPFU0939F1Z")).toBe(false));
  it("computes check digit", () => expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V"));
});

describe("S.16(4) deadline", () => {
  it("FY 2024-25 invoice → 30 Nov 2025", () => expect(itcDeadline("2025-03-31")).toBe("2025-11-30"));
  it("FY 2025-26 invoice → 30 Nov 2026", () => expect(itcDeadline("2025-04-01")).toBe("2026-11-30"));
  it("flags past deadline", () => expect(pastItcDeadline("2024-06-01", new Date("2026-01-01"))).toBe(true));
  it("not past when within window", () => expect(pastItcDeadline("2025-06-01", new Date("2026-01-01"))).toBe(false));
});

describe("rate sanity", () => {
  it("18% valid", () => expect(rateLooksValid(1000, 180)).toBe(true));
  it("13% invalid", () => expect(rateLooksValid(1000, 130)).toBe(false));
});

describe("fuzzyInv", () => {
  it("strips formatting and leading zeros", () => {
    expect(fuzzyInv("inv/001-A")).toBe(fuzzyInv("INV001A"));
    expect(fuzzyInv("0042")).toBe("42");
  });
});

describe("rowChecks", () => {
  it("flags CGST≠SGST", () => {
    expect(rowChecks(rec({ cgst: 90, sgst: 45 })).join()).toMatch(/CGST ≠ SGST/);
  });
  it("flags IGST plus CGST together", () => {
    expect(rowChecks(rec({ igst: 100 })).join()).toMatch(/Both IGST/);
  });
  it("clean row has no issues", () => expect(rowChecks(rec())).toEqual([]));
});

describe("findDuplicates", () => {
  it("detects same GSTIN+invoice twice", () => {
    const d = findDuplicates([rec(), rec({ invoiceNo: "INV/001" })]);
    expect(d.length).toBe(1);
  });
});

describe("reconcile", () => {
  it("PERFECT on exact match", () => {
    const r = reconcile([rec()], [rec()]);
    expect(r[0].type).toBe("PERFECT");
  });
  it("FUZZY_INV on invoice formatting noise", () => {
    const r = reconcile([rec({ invoiceNo: "INV/001" })], [rec({ invoiceNo: "INV001" })]);
    expect(r[0].type).toBe("FUZZY_INV");
  });
  it("HEAD_SWAP when IGST booked but 2B shows CGST+SGST", () => {
    const r = reconcile(
      [rec({ invoiceNo: "X1", igst: 180, cgst: 0, sgst: 0 })],
      [rec({ invoiceNo: "X9", igst: 0, cgst: 90, sgst: 90, invoiceDate: "2025-06-01" })]
    );
    expect(r[0].type).toBe("HEAD_SWAP");
  });
  it("credit note with negative amounts still matches", () => {
    const r = reconcile(
      [rec({ taxableValue: -1000, cgst: -90, sgst: -90 })],
      [rec()]
    );
    expect(r[0].type).toBe("PERFECT");
  });
  it("S.170 rounding ₹1 tolerated", () => {
    const r = reconcile([rec({ cgst: 90 })], [rec({ cgst: 91 })]);
    expect(r[0].type).toBe("PERFECT");
  });
  it("UNMATCHED_A cites S.16(2)(aa)", () => {
    const r = reconcile([rec()], []);
    expect(r[0].type).toBe("UNMATCHED_A");
    expect(r[0].notes).toMatch(/16\(2\)\(aa\)/);
  });
  it("UNMATCHED_B past deadline warns S.16(4)", () => {
    const r = reconcile([], [rec({ invoiceDate: "2024-05-01" })], { today: "2026-06-12" });
    expect(r[0].type).toBe("UNMATCHED_B");
    expect(r[0].notes).toMatch(/16\(4\)/);
    expect(r[0].notes).toMatch(/PASSED/);
  });
  it("does not cross GSTINs", () => {
    const r = reconcile([rec()], [rec({ gst: "29AAGCB7383J1Z4" })]);
    expect(r.find((x) => x.type === "UNMATCHED_A")).toBeTruthy();
  });
});
