export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: unknown;
    };
    const error = Array.isArray(body.error)
      ? body.error
          .map((issue) => {
            if (!issue || typeof issue !== "object") return String(issue);
            const value = issue as { path?: unknown[]; message?: string };
            return `${value.path?.join(".") || "Eingabe"}: ${value.message ?? "ungültig"}`;
          })
          .join(" · ")
      : typeof body.error === "string"
        ? body.error
        : JSON.stringify(body.error);
    throw new Error(error);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
