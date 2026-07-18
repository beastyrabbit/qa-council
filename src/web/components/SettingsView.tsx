/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { Check, CircleAlert, LoaderCircle, LogIn } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AppSettings, ProviderId } from "../../shared/types";
import { api } from "../lib/api";

import { ModelPicker } from "./ViewShared";

export function SettingsView({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [keys, setKeys] = useState({ openrouter: "", openaiImage: "" });
  const [message, setMessage] = useState("");
  const [comfyCheck, setComfyCheck] = useState<{
    loading: boolean;
    message: string;
    checkpoints: string[];
  }>({ loading: false, message: "", checkpoints: [] });
  const [login, setLogin] = useState<{
    id: string;
    status?: string;
    message?: string;
    url?: string;
    userCode?: string;
  } | null>(null);
  const openedLoginUrl = useRef("");

  useEffect(() => {
    if (!login?.id || login.status === "completed" || login.status === "failed") return;
    let active = true;
    const poll = async () => {
      try {
        const state = await api<{
          status: string;
          message: string;
          url?: string;
          userCode?: string;
        }>(`/api/auth/codex/${login.id}`);
        if (!active) return;
        setLogin({ id: login.id, ...state });
        if (state.url && state.status === "waiting" && openedLoginUrl.current !== state.url) {
          openedLoginUrl.current = state.url;
          window.open(state.url, "qa-council-codex-login");
        }
      } catch (reason) {
        if (active) {
          setLogin((current) => ({
            id: current?.id ?? login.id,
            status: "poll-error",
            message: `Anmeldestatus konnte nicht geladen werden: ${
              reason instanceof Error ? reason.message : String(reason)
            }`,
          }));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [login?.id, login?.status]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const saved = await api<AppSettings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          providers: {
            codex: {
              model: draft.providers.codex.model,
              apiKey: keys.openaiImage || undefined,
            },
            openrouter: { ...draft.providers.openrouter, apiKey: keys.openrouter || undefined },
            aibox: draft.providers.aibox,
          },
        }),
      });
      onSaved(saved);
      setKeys({ openrouter: "", openaiImage: "" });
      setMessage("Einstellungen gespeichert.");
    } catch (reason) {
      setMessage(
        `Einstellungen konnten nicht gespeichert werden: ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      );
    }
  }

  async function beginLogin() {
    try {
      const started = await api<{ id: string }>("/api/auth/codex/start", { method: "POST" });
      openedLoginUrl.current = "";
      setLogin(started);
    } catch (reason) {
      setLogin({
        id: "",
        status: "failed",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  async function checkComfyUi() {
    setComfyCheck({ loading: true, message: "Verbindung wird geprüft …", checkpoints: [] });
    try {
      const discovered = await api<{
        reachable: true;
        checkpoints: string[];
        device?: string;
      }>("/api/comfyui/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: draft.comfyui.baseUrl }),
      });
      setDraft((current) => ({
        ...current,
        comfyui: {
          ...current.comfyui,
          checkpoint: discovered.checkpoints.includes(current.comfyui.checkpoint)
            ? current.comfyui.checkpoint
            : (discovered.checkpoints[0] ?? current.comfyui.checkpoint),
        },
      }));
      setComfyCheck({
        loading: false,
        checkpoints: discovered.checkpoints,
        message: discovered.checkpoints.length
          ? `Verbunden${discovered.device ? ` · ${discovered.device}` : ""} · ${discovered.checkpoints.length} Modell(e)`
          : "Verbunden, aber keine Checkpoint-Modelle gefunden.",
      });
    } catch (reason) {
      setComfyCheck({
        loading: false,
        checkpoints: [],
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  function updateProvider(
    provider: ProviderId,
    patch: Partial<AppSettings["providers"][ProviderId]>,
  ) {
    setDraft((current) => ({
      ...current,
      providers: { ...current.providers, [provider]: { ...current.providers[provider], ...patch } },
    }));
  }

  return (
    <form className="settings-page" onSubmit={save}>
      <header className="page-heading">
        <h1>Einstellungen</h1>
        <p>Anbieterzugänge und Standardmodelle für neue Prüfungen.</p>
      </header>
      <section className="settings-section">
        <div>
          <h2>Codex</h2>
          <p>Serverseitige OpenAI-Anmeldung über den Pi-Auth-Speicher.</p>
        </div>
        <div className="settings-fields">
          <div className="auth-row">
            <span className={draft.providers.codex.configured ? "auth-ok" : "auth-missing"}>
              {draft.providers.codex.configured ? <Check size={15} /> : <CircleAlert size={15} />}
              {draft.providers.codex.configured ? "Angemeldet" : "Nicht angemeldet"}
            </span>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => void beginLogin()}
            >
              <LogIn size={16} /> Anmelden
            </button>
          </div>
          {login?.message && (
            <p className="notice">
              {login.message}
              {login.userCode ? <code>{login.userCode}</code> : null}
            </p>
          )}
          <ModelPicker
            provider="codex"
            value={draft.providers.codex.model}
            onChange={(model) => updateProvider("codex", { model })}
          />
          <label>
            <span>
              OpenAI API-Key für GPT Image{" "}
              {draft.providers.codex.imageConfigured && <em>bereits hinterlegt</em>}
            </span>
            <input
              type="password"
              value={keys.openaiImage}
              onChange={(event) => setKeys({ ...keys, openaiImage: event.target.value })}
              placeholder={
                draft.providers.codex.imageConfigured ? "Unverändert lassen" : "sk-proj-…"
              }
              autoComplete="new-password"
            />
            <small>Codex-OAuth bleibt für Text; native Bilder verwenden die OpenAI Bild-API.</small>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>OpenRouter</h2>
          <p>API-Key verschlüsselt auf dem persistenten Datenträger.</p>
        </div>
        <div className="settings-fields">
          <label>
            <span>
              API-Key {draft.providers.openrouter.configured && <em>bereits hinterlegt</em>}
            </span>
            <input
              type="password"
              value={keys.openrouter}
              onChange={(event) => setKeys({ ...keys, openrouter: event.target.value })}
              placeholder={draft.providers.openrouter.configured ? "Unverändert lassen" : "sk-or-…"}
              autoComplete="new-password"
            />
          </label>
          <ModelPicker
            provider="openrouter"
            value={draft.providers.openrouter.model}
            onChange={(model) => updateProvider("openrouter", { model })}
          />
          <label>
            <span>Provider-Routing</span>
            <select
              value={draft.openRouterRouting}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  openRouterRouting: event.target.value as AppSettings["openRouterRouting"],
                })
              }
            >
              <option value="balanced">Ausgewogen · OpenRouter-Standard</option>
              <option value="lowest">Günstigster Anbieter · Preis</option>
              <option value="fastest">Schnellster Anbieter · Durchsatz</option>
            </select>
            <small>
              Ausgewogen nutzt OpenRouters Verfügbarkeits- und Preisgewichtung; schnell priorisiert
              Tokens pro Sekunde.
            </small>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>Lokale AI Box</h2>
          <p>Ollama-Modellliste und OpenAI-kompatible Inferenz.</p>
        </div>
        <div className="settings-fields">
          <label>
            <span>Serveradresse</span>
            <input
              value={draft.providers.aibox.baseUrl ?? ""}
              onChange={(event) => updateProvider("aibox", { baseUrl: event.target.value })}
            />
          </label>
          <ModelPicker
            provider="aibox"
            value={draft.providers.aibox.model}
            onChange={(model) => updateProvider("aibox", { model })}
          />
        </div>
      </section>
      <section className="settings-section">
        <div>
          <h2>ComfyUI-Bilder</h2>
          <p>
            Lokales Titelbild für die AI Box und Rückfall für OpenRouter-Modelle ohne native
            Bildausgabe. Codex verwendet ausschließlich OpenAI GPT Image.
          </p>
        </div>
        <div className="settings-fields">
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.comfyui.enabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  comfyui: { ...draft.comfyui, enabled: event.target.checked },
                })
              }
            />
            Für AI-Box-Läufe und OpenRouter-Fallback aktivieren
          </label>
          <label>
            <span>ComfyUI-Serveradresse</span>
            <div className="field-action">
              <input
                value={draft.comfyui.baseUrl}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    comfyui: { ...draft.comfyui, baseUrl: event.target.value },
                  })
                }
                placeholder="http://192.168.10.120:8188"
              />
              <button
                className="button button--quiet"
                type="button"
                disabled={comfyCheck.loading}
                onClick={() => void checkComfyUi()}
              >
                {comfyCheck.loading ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Verbindung testen
              </button>
            </div>
            {comfyCheck.message && (
              <small className={comfyCheck.checkpoints.length ? "configured" : "not-configured"}>
                {comfyCheck.message}
              </small>
            )}
          </label>
          <label>
            <span>Bildmodell / Checkpoint</span>
            <input
              list="comfyui-checkpoints"
              value={draft.comfyui.checkpoint}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  comfyui: { ...draft.comfyui, checkpoint: event.target.value },
                })
              }
            />
            <datalist id="comfyui-checkpoints">
              {comfyCheck.checkpoints.map((checkpoint) => (
                <option value={checkpoint} key={checkpoint} />
              ))}
            </datalist>
            <small>
              Anima wird mit dem lokal vorhandenen Qwen-Encoder und Qwen-Image-VAE ausgeführt.
            </small>
          </label>
        </div>
      </section>
      <section className="settings-section settings-section--compact">
        <div>
          <h2>Ausgabesprache</h2>
          <p>Standardmäßig folgt das Ergebnis der Dokumentsprache.</p>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.automaticLanguage}
            onChange={(event) => setDraft({ ...draft, automaticLanguage: event.target.checked })}
          />{" "}
          Sprache automatisch erkennen
        </label>
      </section>
      <footer className="settings-actions">
        <span>{message}</span>
        <button className="button button--primary" type="submit">
          Einstellungen speichern
        </button>
      </footer>
    </form>
  );
}
