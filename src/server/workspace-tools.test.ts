import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWorkspaceRelativePath,
  createWorkspaceReadEditTools,
  safeWorkspaceEventPath,
} from "./workspace-tools.js";

const temporaryDirectories: string[] = [];

async function temporaryWorkspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qa-council-workspace-tools-"));
  temporaryDirectories.push(directory);
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace);
  return { directory, workspace };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("sichere Workspace-Werkzeuge", () => {
  it("erlaubt ausschließlich relative Pfade ohne Traversal- oder URI-Syntax", () => {
    expect(() => assertWorkspaceRelativePath("newspaper/front.html")).not.toThrow();
    for (const invalid of [
      "/etc/passwd",
      "../secret",
      "nested/../secret",
      "file:///etc/passwd",
      "~/secret",
      "nested//file.html",
      "front.html\nFAKE-LOG",
      String.raw`C:\Windows\system.ini`,
      String.raw`\\server\share\file`,
    ]) {
      expect(() => assertWorkspaceRelativePath(invalid), invalid).toThrow();
    }
    expect(safeWorkspaceEventPath("/private/secret")).toBe("(abgelehnter Pfad)");
  });

  it("liest und editiert bestehende Dateien innerhalb des Workspace", async () => {
    const { workspace } = await temporaryWorkspace();
    await mkdir(path.join(workspace, "newspaper"));
    await writeFile(path.join(workspace, "newspaper", "front.html"), "<main>Alt</main>", "utf8");
    const toolSet = await createWorkspaceReadEditTools(workspace);
    expect(toolSet.tools.map((tool) => tool.name)).toEqual(["read", "edit"]);
    const read = toolSet.tools.find((tool) => tool.name === "read");
    const edit = toolSet.tools.find((tool) => tool.name === "edit");
    if (!read || !edit) throw new Error("Workspace-Werkzeuge fehlen.");

    const readResult = await read.execute(
      "read-1",
      { path: "newspaper/front.html" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(readResult.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("<main>Alt</main>") }),
    ]);

    await edit.execute(
      "edit-1",
      {
        path: "newspaper/front.html",
        edits: [{ oldText: "Alt", newText: "Neu" }],
      },
      undefined,
      undefined,
      undefined as never,
    );
    expect(await readFile(path.join(workspace, "newspaper", "front.html"), "utf8")).toBe(
      "<main>Neu</main>",
    );
  });

  it("blockiert Symlinks, die aus dem Workspace herausführen", async () => {
    const { directory, workspace } = await temporaryWorkspace();
    const outside = path.join(directory, "secret.txt");
    await writeFile(outside, "nicht lesen", "utf8");
    await symlink(outside, path.join(workspace, "escape.txt"));
    const { tools } = await createWorkspaceReadEditTools(workspace);
    const read = tools.find((tool) => tool.name === "read");
    const edit = tools.find((tool) => tool.name === "edit");
    if (!read || !edit) throw new Error("Workspace-Werkzeuge fehlen.");

    await expect(
      read.execute("read-escape", { path: "escape.txt" }, undefined, undefined, undefined as never),
    ).rejects.toThrow("Symlink-Zugriff außerhalb");
    await expect(
      edit.execute(
        "edit-escape",
        { path: "escape.txt", edits: [{ oldText: "nicht", newText: "doch" }] },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("Symlink-Zugriff außerhalb");
    expect(await readFile(outside, "utf8")).toBe("nicht lesen");
  });

  it("erstellt über edit keine neuen Dateien", async () => {
    const { workspace } = await temporaryWorkspace();
    const { tools } = await createWorkspaceReadEditTools(workspace);
    const edit = tools.find((tool) => tool.name === "edit");
    if (!edit) throw new Error("Workspace-Edit-Werkzeug fehlt.");

    await expect(
      edit.execute(
        "edit-missing",
        { path: "missing.html", edits: [{ oldText: "Alt", newText: "Neu" }] },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("Could not edit file");
    await expect(readFile(path.join(workspace, "missing.html"), "utf8")).rejects.toThrow();
  });
});
