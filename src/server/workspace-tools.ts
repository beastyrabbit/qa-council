import { constants, promises as fs } from "node:fs";
import path from "node:path";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  type EditOperations,
  type ReadOperations,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

const WINDOWS_ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\)/i;

export function assertWorkspaceRelativePath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    value !== value.trim() ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error("Workspace-Pfad muss ein nicht-leerer relativer Pfad sein.");
  }
  if (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    /^file:/i.test(value) ||
    value.startsWith("~")
  ) {
    throw new Error("Workspace-Pfad darf weder absolut noch eine URI oder ein Home-Pfad sein.");
  }
  if (value.includes("//") || value.includes("\\\\")) {
    throw new Error("Workspace-Pfad darf keine doppelten Pfadtrenner enthalten.");
  }
  const segments = value.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new Error("Workspace-Pfad darf das Workspace-Verzeichnis nicht verlassen.");
  }
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

async function canonicalWorkspaceRoot(workspaceDir: string) {
  const root = await fs.realpath(workspaceDir);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Workspace-Pfad ist kein Verzeichnis.");
  return root;
}

async function canonicalExistingFile(root: string, requestedAbsolutePath: string) {
  const lexicalPath = path.resolve(requestedAbsolutePath);
  if (!isContained(root, lexicalPath)) {
    throw new Error("Dateizugriff außerhalb des Workspace wurde blockiert.");
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(lexicalPath);
  } catch {
    throw new Error("Workspace-Datei existiert nicht.");
  }
  if (!isContained(root, canonicalPath)) {
    throw new Error("Symlink-Zugriff außerhalb des Workspace wurde blockiert.");
  }
  const stat = await fs.stat(canonicalPath);
  if (!stat.isFile()) throw new Error("Workspace-Zugriff ist nur auf bestehende Dateien erlaubt.");
  return canonicalPath;
}

export interface WorkspaceToolSet {
  root: string;
  tools: ToolDefinition[];
}

export async function createWorkspaceReadEditTools(
  workspaceDir: string,
  options: { editableFiles?: string[] } = {},
): Promise<WorkspaceToolSet> {
  const root = await canonicalWorkspaceRoot(workspaceDir);
  const resolveFile = (absolutePath: string) => canonicalExistingFile(root, absolutePath);
  const editableFiles = options.editableFiles
    ? new Set(
        options.editableFiles.map((file) => {
          assertWorkspaceRelativePath(file);
          return file.replaceAll("\\", "/");
        }),
      )
    : null;
  const resolveEditableFile = async (absolutePath: string) => {
    const file = await resolveFile(absolutePath);
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (editableFiles && !editableFiles.has(relative)) {
      throw new Error(`Workspace-Datei ist schreibgeschützt: ${relative}`);
    }
    return file;
  };

  const readOperations: ReadOperations = {
    async access(absolutePath) {
      const file = await resolveFile(absolutePath);
      await fs.access(file, constants.R_OK);
    },
    async readFile(absolutePath) {
      const file = await resolveFile(absolutePath);
      return fs.readFile(file);
    },
    async detectImageMimeType() {
      return null;
    },
  };
  const editOperations: EditOperations = {
    async access(absolutePath) {
      const file = await resolveEditableFile(absolutePath);
      await fs.access(file, constants.R_OK | constants.W_OK);
    },
    async readFile(absolutePath) {
      const file = await resolveFile(absolutePath);
      return fs.readFile(file);
    },
    async writeFile(absolutePath, content) {
      const file = await resolveEditableFile(absolutePath);
      await fs.access(file, constants.R_OK | constants.W_OK);
      await fs.writeFile(file, content, "utf8");
    },
  };

  const baseRead = createReadToolDefinition(root, { operations: readOperations });
  const read: typeof baseRead = {
    ...baseRead,
    async execute(toolCallId, input, signal, onUpdate, context) {
      assertWorkspaceRelativePath(input.path);
      return baseRead.execute(toolCallId, input, signal, onUpdate, context);
    },
  };
  const baseEdit = createEditToolDefinition(root, { operations: editOperations });
  const edit: typeof baseEdit = {
    ...baseEdit,
    async execute(toolCallId, input, signal, onUpdate, context) {
      assertWorkspaceRelativePath(input.path);
      return baseEdit.execute(toolCallId, input, signal, onUpdate, context);
    },
  };

  // Pi's erased ToolDefinition[] boundary is invariant in its schema generic.
  return { root, tools: [read, edit] as unknown as ToolDefinition[] };
}

export function safeWorkspaceEventPath(value: unknown) {
  try {
    assertWorkspaceRelativePath(value);
    return value.replaceAll("\\", "/");
  } catch {
    return "(abgelehnter Pfad)";
  }
}
