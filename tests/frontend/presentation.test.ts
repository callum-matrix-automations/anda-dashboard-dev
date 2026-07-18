import { describe, expect, it } from "vitest";
import { artifactStateFor } from "../../src/frontend/presentation/artifact";
import { newestFirst } from "../../src/frontend/presentation/history";

describe("frontend presentation helpers", () => {
  it("maps lifecycle values without mutating them", () => {
    expect(artifactStateFor("PDF_PROCESSING")).toBe("processing");
    expect(artifactStateFor("COMPLETED")).toBe("signed");
  });

  it("sorts history newest first without changing the source", () => {
    const history = [
      { id: "1", actor: "A", action: "edit_saved" as const, at: "2026-01-01T00:00:00Z", note: null },
      { id: "2", actor: "B", action: "approved" as const, at: "2026-01-02T00:00:00Z", note: null },
    ];
    expect(newestFirst(history).map((entry) => entry.id)).toEqual(["2", "1"]);
    expect(history.map((entry) => entry.id)).toEqual(["1", "2"]);
  });
});
