import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("presentation style cascade", () => {
  it("excludes authored reports from generic and legacy report styling", () => {
    const fallbackScope = styles.indexOf(
      "@scope (.rendered-result:not(.rendered-result--authored)) {",
    );
    const layerStart = styles.indexOf("@layer legacy-report {", fallbackScope);
    const legacyTabloidRule = styles.indexOf("border-top: 8px solid #e30613;");
    const scopeEnd = styles.indexOf("\n.result-appendix", layerStart);

    expect(fallbackScope).toBeGreaterThanOrEqual(0);
    expect(layerStart).toBeGreaterThanOrEqual(0);
    expect(legacyTabloidRule).toBeGreaterThan(layerStart);
    expect(scopeEnd).toBeGreaterThan(legacyTabloidRule);
  });

  it("scopes legacy responsive report overrides as well", () => {
    const responsiveLayers = styles.match(/@layer legacy-report \{/g);
    const fallbackScopes = styles.match(
      /@scope \(\.rendered-result:not\(\.rendered-result--authored\)\) \{/g,
    );

    expect(responsiveLayers).toHaveLength(3);
    expect(fallbackScopes).toHaveLength(3);
  });
});
