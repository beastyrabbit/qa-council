import { Check, CircleAlert, CircleX, LogIn, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AppSettings, EmbeddingModel, ProviderId } from "../../shared/types";
import { api } from "../lib/api";
import { ModelPicker } from "./ViewShared";

export function SettingsView({
  settings,
  onSaved,
  onDirtyChange,
}: {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [baseline, setBaseline] = useState(settings);
  const [keys, setKeys] = useState({ openrouter: "", openaiImage: "" });
  const [saveError, setSaveError] = useState("");
  const [embeddingModels, setEmbeddingModels] = useState<{
    loading: boolean;
    models: EmbeddingModel[];
    error: string;
  }>({ loading: false, models: [], error: "" });
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

  const dirty = useMemo(
    () =>
      JSON.stringify(draft) !== JSON.stringify(baseline) ||
      Boolean(keys.openrouter || keys.openaiImage),
    [draft, baseline, keys],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

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

  useEffect(() => {
    if (!settings.providers.aibox.baseUrl) return;
    let active = true;
    setEmbeddingModels((current) => ({ ...current, loading: true, error: "" }));
    api<EmbeddingModel[]>("/api/providers/aibox/embedding-models")
      .then((models) => {
        if (active) setEmbeddingModels({ loading: false, models, error: "" });
      })
      .catch((reason) => {
        if (active) {
          setEmbeddingModels({
            loading: false,
            models: [],
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [settings.providers.aibox.baseUrl]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaveError("");
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
      setDraft(saved);
      setBaseline(saved);
      setKeys({ openrouter: "", openaiImage: "" });
      toast.success("Einstellungen gespeichert.");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function discard() {
    setDraft(baseline);
    setKeys({ openrouter: "", openaiImage: "" });
    setSaveError("");
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
    <form
      className="settings-page mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8 pb-28 lg:py-10"
      onSubmit={save}
    >
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Einstellungen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anbieterzugänge und Standardmodelle für neue Prüfungen.
        </p>
      </header>

      {saveError && (
        <Alert variant="destructive">
          <CircleX />
          <AlertTitle>Einstellungen konnten nicht gespeichert werden</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Codex</CardTitle>
          <CardDescription>
            Serverseitige OpenAI-Anmeldung über den Pi-Auth-Speicher.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            {draft.providers.codex.configured ? (
              <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                <Check /> Angemeldet
              </Badge>
            ) : (
              <Badge variant="destructive">
                <CircleAlert /> Nicht angemeldet
              </Badge>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void beginLogin()}>
              <LogIn /> Anmelden
            </Button>
          </div>
          {login?.message && (
            <Alert>
              <CircleAlert />
              <AlertDescription>
                {login.message}
                {login.userCode ? (
                  <code className="mt-2 block w-fit rounded bg-muted px-2 py-1 font-mono text-sm">
                    {login.userCode}
                  </code>
                ) : null}
              </AlertDescription>
            </Alert>
          )}
          <ModelPicker
            provider="codex"
            value={draft.providers.codex.model}
            onChange={(model) => updateProvider("codex", { model })}
          />
          <Field>
            <FieldLabel htmlFor="settings-openai-key">
              OpenAI API-Key für GPT Image
              {draft.providers.codex.imageConfigured && (
                <span className="ml-1 font-normal text-primary">· bereits hinterlegt</span>
              )}
            </FieldLabel>
            <Input
              id="settings-openai-key"
              type="password"
              value={keys.openaiImage}
              onChange={(event) => setKeys({ ...keys, openaiImage: event.target.value })}
              placeholder={
                draft.providers.codex.imageConfigured ? "Unverändert lassen" : "sk-proj-…"
              }
              autoComplete="new-password"
            />
            <FieldDescription>
              Codex-OAuth bleibt für Text; native Bilder verwenden die OpenAI Bild-API.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">OpenRouter</CardTitle>
          <CardDescription>API-Key verschlüsselt auf dem persistenten Datenträger.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="settings-openrouter-key">
              API-Key
              {draft.providers.openrouter.configured && (
                <span className="ml-1 font-normal text-primary">· bereits hinterlegt</span>
              )}
            </FieldLabel>
            <Input
              id="settings-openrouter-key"
              type="password"
              value={keys.openrouter}
              onChange={(event) => setKeys({ ...keys, openrouter: event.target.value })}
              placeholder={draft.providers.openrouter.configured ? "Unverändert lassen" : "sk-or-…"}
              autoComplete="new-password"
            />
          </Field>
          <ModelPicker
            provider="openrouter"
            value={draft.providers.openrouter.model}
            onChange={(model) => updateProvider("openrouter", { model })}
          />
          <Field>
            <FieldLabel htmlFor="settings-routing">Provider-Routing</FieldLabel>
            <Select
              value={draft.openRouterRouting}
              onValueChange={(value) =>
                value &&
                setDraft({
                  ...draft,
                  openRouterRouting: value as AppSettings["openRouterRouting"],
                })
              }
            >
              <SelectTrigger id="settings-routing" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Ausgewogen · OpenRouter-Standard</SelectItem>
                <SelectItem value="lowest">Günstigster Anbieter · Preis</SelectItem>
                <SelectItem value="fastest">Schnellster Anbieter · Durchsatz</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Ausgewogen nutzt OpenRouters Verfügbarkeits- und Preisgewichtung; schnell priorisiert
              Tokens pro Sekunde.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Lokale AI Box</CardTitle>
          <CardDescription>Ollama-Modellliste und OpenAI-kompatible Inferenz.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="settings-aibox-url">Serveradresse</FieldLabel>
            <Input
              id="settings-aibox-url"
              value={draft.providers.aibox.baseUrl ?? ""}
              onChange={(event) => updateProvider("aibox", { baseUrl: event.target.value })}
            />
          </Field>
          <ModelPicker
            provider="aibox"
            value={draft.providers.aibox.model}
            onChange={(model) => updateProvider("aibox", { model })}
          />
          <label
            htmlFor="settings-embedding-enabled"
            className="check-row flex cursor-pointer items-center gap-3 text-sm"
          >
            <Switch
              id="settings-embedding-enabled"
              checked={draft.embedding.enabled}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  embedding: { ...draft.embedding, enabled: checked === true },
                })
              }
            />
            Lokale Embeddings für dokumentweite RACI- und Chunk-Beziehungen verwenden
          </label>
          <Field>
            <FieldLabel htmlFor="settings-embedding-model">Embedding-Modell</FieldLabel>
            <Input
              id="settings-embedding-model"
              list="aibox-embedding-models"
              value={draft.embedding.model}
              disabled={!draft.embedding.enabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  embedding: { ...draft.embedding, model: event.target.value },
                })
              }
            />
            <datalist id="aibox-embedding-models">
              {embeddingModels.models.map((model) => (
                <option value={model.id} key={model.id} />
              ))}
            </datalist>
            <FieldDescription
              className={cn(embeddingModels.error ? "text-destructive" : "text-primary")}
            >
              {embeddingModels.loading
                ? "Embedding-Modelle werden gelesen …"
                : embeddingModels.error ||
                  `${draft.embedding.model} · ${draft.embedding.dimensions} Dimensionen · lokale, gecachte Voranalyse`}
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">ComfyUI-Bilder</CardTitle>
          <CardDescription>
            Lokales Titelbild für die AI Box und Rückfall für OpenRouter-Modelle ohne native
            Bildausgabe. Codex verwendet ausschließlich OpenAI GPT Image.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label
            htmlFor="settings-comfyui-enabled"
            className="check-row flex cursor-pointer items-center gap-3 text-sm"
          >
            <Switch
              id="settings-comfyui-enabled"
              checked={draft.comfyui.enabled}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  comfyui: { ...draft.comfyui, enabled: checked === true },
                })
              }
            />
            Für AI-Box-Läufe und OpenRouter-Fallback aktivieren
          </label>
          <Field>
            <FieldLabel htmlFor="settings-comfyui-url">ComfyUI-Serveradresse</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="settings-comfyui-url"
                value={draft.comfyui.baseUrl}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    comfyui: { ...draft.comfyui, baseUrl: event.target.value },
                  })
                }
                placeholder="http://192.168.10.120:8188"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={comfyCheck.loading}
                onClick={() => void checkComfyUi()}
              >
                {comfyCheck.loading ? <Spinner /> : <Check />} Verbindung testen
              </Button>
            </div>
            {comfyCheck.message && (
              <FieldDescription
                className={cn(comfyCheck.checkpoints.length ? "text-primary" : "text-destructive")}
              >
                {comfyCheck.message}
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-comfyui-checkpoint">Bildmodell / Checkpoint</FieldLabel>
            <Input
              id="settings-comfyui-checkpoint"
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
            <FieldDescription>
              Anima wird mit dem lokal vorhandenen Qwen-Encoder und Qwen-Image-VAE ausgeführt.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Ausgabesprache</CardTitle>
          <CardDescription>Standardmäßig folgt das Ergebnis der Dokumentsprache.</CardDescription>
        </CardHeader>
        <CardContent>
          <label
            htmlFor="settings-auto-language"
            className="check-row flex cursor-pointer items-center gap-3 text-sm"
          >
            <Switch
              id="settings-auto-language"
              checked={draft.automaticLanguage}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, automaticLanguage: checked === true })
              }
            />
            Sprache automatisch erkennen
          </label>
        </CardContent>
      </Card>

      <footer
        className={cn(
          "settings-actions fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur transition-transform md:left-(--sidebar-width)",
          dirty ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <span className="text-sm text-muted-foreground">Ungespeicherte Änderungen</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={discard}>
              <RotateCcw /> Verwerfen
            </Button>
            <Button type="submit">Einstellungen speichern</Button>
          </div>
        </div>
      </footer>
    </form>
  );
}
