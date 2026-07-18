/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: HTML wird serverseitig mit einer expliziten Allowlist sanitisiert. */
export function SanitizedMarkdown({ html }: { html: string }) {
  return (
    <div
      className="model-output model-output--markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
