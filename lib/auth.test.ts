import { describe, it, expect } from "bun:test";
import { NotActiveError } from "./auth";

describe("error classes", () => {
  it("NotActiveError carries a status string", () => {
    const e = new NotActiveError("trial");
    expect(e.status).toBe("trial");
    expect(e).toBeInstanceOf(Error);
  });
});
