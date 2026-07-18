import { describe, expect, it } from "vitest";

describe("offline test guard", () => {
  it("blocks external HTTP requests before a connection is opened", async () => {
    await expect(fetch("https://provider.invalid/models")).rejects.toThrow(
      "Automated tests must not contact external hosts",
    );
  });
});
