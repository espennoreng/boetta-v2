import { describe, expect, test } from "bun:test";
import { composeSystemPrompt } from "./compose-system-prompt";

describe("composeSystemPrompt", () => {
  test("persona-only: returns just the persona text", () => {
    const result = composeSystemPrompt({
      persona: "Du er en assistent.",
    });
    expect(result).toBe("Du er en assistent.");
  });

  test("persona + workflow: wraps workflow in ## Arbeidsflyt", () => {
    const result = composeSystemPrompt({
      persona: "Du er en assistent.",
      workflow: "1. Gjør noe.\n2. Gjør noe annet.",
    });
    expect(result).toBe(
      "Du er en assistent.\n\n## Arbeidsflyt\n\n1. Gjør noe.\n2. Gjør noe annet."
    );
  });

  test("empty workflow string skips the workflow section", () => {
    const result = composeSystemPrompt({
      persona: "Du er en assistent.",
      workflow: "",
    });
    expect(result).toBe("Du er en assistent.");
  });

  test("conventions render in order, each with its own heading", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      conventions: [
        "## First\n\nFirst body.",
        "## Second\n\nSecond body.",
      ],
    });
    expect(result).toBe(
      "P.\n\n## First\n\nFirst body.\n\n## Second\n\nSecond body."
    );
  });

  test("toolGuidance renders like conventions — no auto-wrapper", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      toolGuidance: ["## Tool A\n\nUse A.", "## Tool B\n\nUse B."],
    });
    expect(result).toContain("## Tool A");
    expect(result).toContain("## Tool B");
    expect(result).not.toContain("## Verktøybruk");
  });

  test("dynamicSections take { heading, body } and render as ## heading + body", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      dynamicSections: [
        { heading: "Sjekkpunktindeks", body: "1.1 Ok\n1.2 Also ok" },
      ],
    });
    expect(result).toBe(
      "P.\n\n## Sjekkpunktindeks\n\n1.1 Ok\n1.2 Also ok"
    );
  });

  test("full composition: persona → workflow → conventions → toolGuidance → dynamicSections", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      workflow: "W.",
      conventions: ["## C1\n\nC1b."],
      toolGuidance: ["## T1\n\nT1b."],
      dynamicSections: [{ heading: "D1", body: "D1b." }],
    });
    expect(result).toBe(
      [
        "P.",
        "## Arbeidsflyt\n\nW.",
        "## C1\n\nC1b.",
        "## T1\n\nT1b.",
        "## D1\n\nD1b.",
      ].join("\n\n")
    );
  });

  test("empty arrays skip their slot entirely", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      conventions: [],
      toolGuidance: [],
      dynamicSections: [],
    });
    expect(result).toBe("P.");
  });

  test("undefined promptFragment entries in toolGuidance are ignored gracefully", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      toolGuidance: ["## A\n\nAbody.", undefined, "## B\n\nBbody."].filter(
        (s): s is string => Boolean(s),
      ),
    });
    expect(result).toContain("## A");
    expect(result).toContain("## B");
  });
});
