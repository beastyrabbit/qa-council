const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

delete process.env.OPENAI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.AIBOX_URL;
delete process.env.COMFYUI_URL;
delete process.env.COMFYUI_CHECKPOINT;

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url =
    input instanceof Request ? new URL(input.url) : new URL(String(input), "http://localhost");
  if (["http:", "https:"].includes(url.protocol) && !localHosts.has(url.hostname)) {
    throw new Error(`Automated tests must not contact external hosts: ${url.hostname}`);
  }
  return nativeFetch(input, init);
};
