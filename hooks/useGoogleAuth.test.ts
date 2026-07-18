import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeJwtPayload } from "./useGoogleAuth";

// Browser atob is STRICT: it throws on the base64url alphabet ("-"/"_") that
// JWT segments use. Node's atob is lenient and decodes base64url silently, so
// running these tests against the real global would mask exactly the regression
// they exist to catch — stub in a spec-faithful strict decoder instead.
function strictAtob(s: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) {
    throw new DOMException(
      "The string to be decoded is not correctly encoded.",
      "InvalidCharacterError",
    );
  }
  return Buffer.from(s, "base64").toString("binary");
}

const tokenFor = (payload: object): string =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("decodeJwtPayload (browser-strict atob)", () => {
  beforeEach(() => vi.stubGlobal("atob", strictAtob));
  afterEach(() => vi.unstubAllGlobals());

  it("decodes a plain-ASCII payload", () => {
    const payload = { email: "owner@gmail.com", exp: 1752803600 };
    expect(decodeJwtPayload(tokenFor(payload))).toEqual(payload);
  });

  it("decodes a payload whose segment uses the base64url alphabet (raw atob throws)", () => {
    // A Thai profile name yields non-ASCII UTF-8 bytes, which can put "-"/"_"
    // into the base64url segment — the exact case the old raw-atob code broke
    // on. Whether they appear depends on byte ALIGNMENT of the whole payload,
    // so this exact fixture (verified to encode 3 of them) must not be reworded
    // casually; the guard assertion below protects that premise.
    const payload = {
      email: "x@gmail.com",
      name: "จันทร์เพ็ญ",
      exp: 1752803600,
    };
    const seg = tokenFor(payload).split(".")[1];
    expect(seg).toMatch(/[-_]/); // fixture really exercises the base64url case
    expect(() => strictAtob(seg)).toThrow(); // the pre-fix path

    const decoded = decodeJwtPayload(tokenFor(payload));
    // Only the ASCII fields are read by the auth flow; the latin1-mojibake
    // `name` is irrelevant and deliberately not asserted.
    expect(decoded.email).toBe(payload.email);
    expect(decoded.exp).toBe(payload.exp);
  });

  it("re-pads unpadded segments of every length residue", () => {
    // base64url drops "="; these email lengths make the JSON 25/26/27 bytes,
    // landing the unpadded segment on %4 residues 2, 3, and 0 — every residue
    // valid base64 can produce — so the padding arithmetic is fully exercised.
    for (const email of ["a@b.c", "ab@c.d", "ab@c.de"]) {
      const payload = { email, exp: 1 };
      expect(decodeJwtPayload(tokenFor(payload))).toEqual(payload);
    }
  });

  it("throws on a malformed token (caller treats it as an invalid session)", () => {
    expect(() => decodeJwtPayload("garbage")).toThrow();
    expect(() => decodeJwtPayload("")).toThrow();
  });
});
