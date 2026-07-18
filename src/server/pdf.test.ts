import { describe, expect, it } from "vitest";
import { renderedResultClassFor } from "./pdf.js";

describe("presentation document wrapper", () => {
  it("isolates authored report CSS from legacy application styles", () => {
    expect(
      renderedResultClassFor(
        "<style data-report-workspace>@scope (.result--onepaper) {}</style><main></main>",
      ),
    ).toBe("rendered-result rendered-result--authored");
  });

  it("keeps legacy presentation styling for reports without authored CSS", () => {
    expect(renderedResultClassFor('<main class="result"></main>')).toBe("rendered-result");
  });
});
