import { describe, it, expect } from "bun:test";
import { isSuperadmin, NotSuperadminError, NotActiveError } from "./auth";

describe("isSuperadmin", () => {
  it("returns true when publicMetadata.role === 'superadmin'", () => {
    expect(isSuperadmin({ role: "superadmin" })).toBe(true);
  });

  it("returns false for other roles", () => {
    expect(isSuperadmin({ role: "member" })).toBe(false);
    expect(isSuperadmin({ role: undefined })).toBe(false);
    expect(isSuperadmin({})).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
    expect(isSuperadmin(undefined)).toBe(false);
  });
});

describe("error classes", () => {
  it("NotSuperadminError is an Error subclass", () => {
    const e = new NotSuperadminError();
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("superadmin");
  });

  it("NotActiveError carries a status string", () => {
    const e = new NotActiveError("pending");
    expect(e.status).toBe("pending");
    expect(e).toBeInstanceOf(Error);
  });
});
