import { describe, it, expect } from "bun:test";
import { riksantikvarenCheckToolDefinition } from "./riksantikvaren";

describe("tool definition", () => {
  it("is named riksantikvaren_check and requires only matrikkel_id", () => {
    expect(riksantikvarenCheckToolDefinition.name).toBe("riksantikvaren_check");
    expect(riksantikvarenCheckToolDefinition.type).toBe("custom");
    const schema = riksantikvarenCheckToolDefinition.input_schema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["matrikkel_id"]);
    expect(Object.keys(schema.properties)).toEqual(["matrikkel_id"]);
  });
});
