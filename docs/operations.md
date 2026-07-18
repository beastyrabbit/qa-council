# Betrieb

## Voraussetzungen

- Node.js 24 oder neuer
- pnpm
- Portless
- optional Docker beziehungsweise eine erreichbare Tika-Instanz

## Installation und Entwicklung

```bash
pnpm install
portless
```

Portless startet das `dev`-Script. Die API hört lokal fest auf Port 3001, Vite übernimmt den von Portless vergebenen Anwendungsport. Die stabile Adresse lautet je nach laufender Portless-Konfiguration beispielsweise:

```text
http://qa-council.localhost:1355
```

Ohne Portless kann `pnpm dev` verwendet werden; Vite läuft dann standardmäßig auf Port 5173.

Für binäre Dokumente kann Tika separat gestartet werden:

```bash
docker compose up tika
```

Oder die gesamte lokale Containerumgebung:

```bash
docker compose up --build
```

## Umgebungsvariablen

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3001` lokal, `3000` im Container | HTTP-Port der Fastify-Anwendung |
| `API_PORT` | nicht gesetzt | expliziter API-Port für den Entwicklungsmodus |
| `DATA_DIR` | `./data` | SQLite, Verschlüsselungsschlüssel und Pi-Auth |
| `TIKA_URL` | `http://127.0.0.1:9998` | Apache-Tika-Basisadresse |
| `AIBOX_URL` | nicht gesetzt | lokale Ollama-kompatible AI Box |
| `COMFYUI_URL` | nicht gesetzt | lokale ComfyUI-Basisadresse |
| `COMFYUI_CHECKPOINT` | nicht gesetzt | vorausgewählter ComfyUI-Checkpoint |
| `PI_INFERENCE_TIMEOUT_MS` | `900000` | Zeitlimit einer Pi-Inferenz |
| `RUN_SLOTS` | `3` | global gleichzeitig aktive Läufe |
| `CODEX_RUN_SLOTS` / `OPENROUTER_RUN_SLOTS` / `AIBOX_RUN_SLOTS` | `2` / `2` / `1` | providerbezogene Run-Limits |
| `CODEX_INFERENCE_SLOTS` / `OPENROUTER_INFERENCE_SLOTS` / `AIBOX_INFERENCE_SLOTS` | `6` / `6` / `2` | providerbezogene Inference-Limits |
| `OPENROUTER_API_KEY` | nicht gesetzt | OpenRouter-Zugang |
| `OPENAI_API_KEY` | nicht gesetzt | Native OpenAI-Bildgenerierung für Codex-Läufe |
| `SETTINGS_ENCRYPTION_KEY` | lokales Schlüssel-File | Schlüsselmaterial für gespeicherte Provider-Keys |
| `CHROMIUM_PATH` | `/usr/bin/chromium` | Chromium-Binary für PDF-Export und visuellen Screenshot-Review |

## Qualitätsprüfungen

```bash
pnpm check
```

Der Befehl führt aus:

1. Biome-Linter
2. TypeScript-Prüfung für Frontend und Server
3. Vitest
4. Produktionsbuild

Vor Commits führt Lefthook zusätzlich Gitleaks aus.

`pnpm test:gui` ist ein manueller lokaler Chromium-Test gegen einen laufenden Server. Optionale
`GUI_*`-IDs erweitern ihn um vorhandene Runs, Presentations und Vergleiche. Er ist bewusst nicht
Teil des CI-Quality-Jobs, startet keine Analyse und lädt Provider-Modellkataloge erst nach einer
bewussten Interaktion. Das kanonische Upload-Fixture liegt unter
`test/fixtures/gui-council-input.md`.

Automatische Tests bleiben vollständig offline: Sie entfernen Provider-Schlüssel aus dem
Testprozess, blockieren Live-Provider und dürfen keine KI-Analyse starten. Jeder Token kostet Geld;
deshalb ist höchstens ein manueller Live-Abnahmelauf zulässig, und auch nur nach einer
ausdrücklichen Benutzeranweisung für genau diesen Lauf. OpenRouter wird ausschließlich nach einer
ausdrücklichen OpenRouter-Anweisung getestet.

Retrieval-Tests injizieren deterministische 4.096-dimensionale Testvektoren. Sie rufen weder
`/api/embed` noch ein anderes Live-Modell auf. Auch ein lokaler Embedding-Abnahmelauf ist eine
Live-KI-Ausführung und darf nur nach einer ausdrücklichen Benutzeranweisung für genau diesen Lauf
gestartet werden.

## Daten und Backups

Für eine vollständige Wiederherstellung müssen gemeinsam gesichert werden:

- `qa-council.sqlite`
- `qa-council.sqlite-wal` und `qa-council.sqlite-shm`, falls SQLite während des Backups läuft
- `settings.key`, sofern kein fester `SETTINGS_ENCRYPTION_KEY` verwendet wird
- `pi/auth.json`, falls die Codex-OAuth-Anmeldung wiederhergestellt werden soll

Generierte ComfyUI-Bilder liegen als BLOB in `qa-council.sqlite` und sind damit im Datenbankbackup enthalten.

Im Kubernetes-Betrieb liegt das gesamte Verzeichnis unter `/data` auf einem Longhorn-PVC. Für konsistente Offline-Backups sollte die Anwendung angehalten werden. Alternativ ist die SQLite-Backup-API beziehungsweise ein Storage-Snapshot zu verwenden.

## Statusmodell eines Laufs

| Status | Bedeutung |
|---|---|
| `queued` | Lauf wurde angenommen |
| `running` | Council oder Präsentation arbeitet |
| `waiting_for_input` | Ground-or-Ask wartet auf eine Antwort |
| `completed` | Finales Ergebnis und erste Darstellung sind fertig |
| `failed` | Eine Stufe ist fehlgeschlagen; Ursache steht im Detailprotokoll |

## Fehleranalyse

### Dokument bleibt auf Fehler

- Im Laufprotokoll die Stufe **Dokumentextraktion** und deren Seitenfortschritt prüfen.
- Bei Textdateien Encoding und tatsächlichen Inhalt prüfen.
- Bei Binärformaten `TIKA_URL` und `/version` prüfen.
- Tika-Ressourcen und Pod-Logs prüfen.
- Ein fehlgeschlagener Seitenversuch blockiert andere Seiten nicht und wird bei einem neuen Lauf
  erneut versucht.

### Provider ist nicht konfiguriert

- Codex: OAuth in den Einstellungen starten oder `pi /login` im Container ausführen.
- OpenRouter: Infisical-Sync oder gespeicherten API-Key prüfen.
- AI Box: Erreichbarkeit von `/api/tags` und `/v1/models` prüfen.

### Lauf wartet auf Eingabe

Dies ist kein Fehler. Auf der Vollseiten-Laufansicht steht die konkrete Ground-or-Ask-Frage. Nach Absenden der Antwort wird die Prüfung wieder aufgenommen.

## Laufprotokoll, Archiv und Ergebnisse

- `/laeufe/<run-id>` ist direkt aufrufbar und pollt nur in der aktiven Detailansicht den
  cursorbasierten Activity-Stream.
- `/laeufe/<run-id>/dateien/<artifact-id>?attempt=N` ist der reload- und history-sichere
  Vollseitenreader; Inhalte werden lazy geladen.
- **Report-Design · Tageszeitung und Visual Report** ist eine echte Modellstufe. Ihre direkte HTML-Ausgabe läuft sichtbar durch dasselbe Live-Protokoll wie Triage, Rollenreviews und Synthese.
- Thinking ist separat eingeklappt. Das Systemprotokoll enthält nur relevante Orchestrierungs-, Retry-, Kompaktierungs- und Abschlussmeldungen statt Pi-Lifecycle-Rauschen.
- Im Menü **Läufe** können alle abgeschlossenen und fehlgeschlagenen Läufe gemeinsam archiviert werden. Das eigene Menü **Archiv** erlaubt Öffnen und Wiederherstellen. Nur fehlgeschlagene Läufe dürfen dauerhaft gelöscht werden.
- Im Menü **Dokumente** stehen hochgeladene Originale, extrahierter Text, bisherige Läufe und **Erneut prüfen** bereit. Die Seite **Prüfen** enthält nur Upload, Auswahl und Laufkonfiguration.
- Der Menüpunkt **Testmodus** nimmt ein Vergleichsdokument und bis zu drei Provider-/Modellkombinationen auf. Jede Modellliste hat direkt über dem Dropdown eine Suche nach Name oder ID. Nicht konfigurierte oder nicht erreichbare Kombinationen werden nicht gestartet. Die erzeugten Läufe bleiben vollständig aus **Läufe**, **Archiv** und der normalen Dokumentlaufhistorie heraus und sind unter stabilen `/tests/:id`-URLs vergleichbar.
- Nach Abschluss der Report-Design-Stufe erscheint `report_static_check_completed` im Systemlog. Bei HTML-, CSS- oder JavaScript-Befunden folgt einmalig die sichtbare Stufe **Report-QA · statische Korrektur** und danach `report_static_recheck_completed`. Eine weiterhin ungültige zweite Fassung beendet den Lauf nachvollziehbar als Fehler.
- Nach einem Prozessneustart werden gequeue-te und unterbrochene Läufe über dieselbe zentrale Queue
  im aktuellen Attempt wieder eingeplant.
- Jede Darstellung hat mit `/results/<presentation-id>` eine stabile, kopierbare URL. Der SPA-Fallback stellt sicher, dass diese URL auch nach einem direkten Reload funktioniert.
- Zeitungsressorts sind echte Unterseiten unter `/results/<presentation-id>/<ressort-slug>` und können einzeln kopiert oder neu geladen werden.
- Pro neuem Lauf erzeugt der Report-Designer Tageszeitung und Visual Report gemeinsam. Das dokumentbezogene Motiv kommt bei Codex nativ von OpenAI, bei einem bildfähigen OpenRouter-Modell nativ von OpenRouter und bei der AI Box beziehungsweise als OpenRouter-Fallback von ComfyUI. Es wird in beiden Ausgaben wiederverwendet.
- Codex und visionfähige OpenRouter-Modelle erhalten genau einen Chromium-Screenshot-Review der fertigen HTML-Ausgabe. Die lokale AI Box wird davon bewusst ausgenommen.
- Der Visual Report kann als mehrseitiges PDF geladen werden; seine HTML-Infografiken und Kapitel bleiben dabei erhalten.

### AI Box meldet Verbindungsfehler

```bash
curl -fsS http://192.168.10.120:11434/api/tags
curl -fsS http://192.168.10.120:11434/v1/models
```

Bei `no route to host` liegt ein Netzwerk- oder Hostproblem vor. Ein Modellwechsel behebt keine fehlende Route.

### ComfyUI-Bild fehlt

- In den Einstellungen **Verbindung testen** ausführen und den erkannten Checkpoint kontrollieren.
- Für Anima müssen zusätzlich `qwen_3_06b_base.safetensors` unter `models/text_encoders` und `qwen_image_vae.safetensors` unter `models/vae` verfügbar sein.
- Im Laufprotokoll nach `ComfyUI-Workflow wurde eingereiht`, `ComfyUI-Titelbild wurde gespeichert` oder einer Warnung mit der konkreten Workflow-Ursache suchen.
- Direkt prüfen:

```bash
curl -fsS http://192.168.10.120:8188/system_stats
curl -fsS http://192.168.10.120:8188/models/checkpoints
```

### AI Box meldet ein zu kleines Kontextfenster

Modellmaximum, Modelfile-Parameter und tatsächlich geladene Größe prüfen:

```bash
curl -fsS http://192.168.10.120:11434/api/show \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3-coder-next:q4km"}'
curl -fsS http://192.168.10.120:11434/api/ps
```

Ein hohes `*.context_length` in `model_info` ist nur das theoretische Maximum. Ein kleineres `PARAMETER num_ctx` im Modelfile oder `context_length` in `/api/ps` ist die wirksame Grenze. Die OpenAI-kompatible Schnittstelle kann diese Grenze nicht pro Council-Request erhöhen; dafür muss die Ollama-Serverkonfiguration oder ein Modellalias angepasst werden.

### Lokale Dokument-Voranalyse verwendet den Retrieval-Rückfall

- In den Einstellungen prüfen, ob lokale Embeddings aktiviert und
  `qwen3-embedding:8b` ausgewählt ist.
- `/api/show` muss für das Modell `embedding` in `capabilities` melden.
- Die konkrete Ursache steht als `embedding_fallback` im Laufprotokoll.
- Der Lauf bleibt fachlich ausführbar: Originalchunks werden weiterhin vollständig geprüft, nur
  die semantischen Navigationshinweise fehlen. Exakte Begriffe und Chunk-Nachbarschaften bleiben
  aktiv.

### Skill-Integritätsfehler

Die Anwendung startet eine Modellstufe absichtlich nicht, wenn ein kanonischer Hash abweicht. Änderungen an Skill-Dateien erfordern eine bewusste fachliche Prüfung und anschließend eine Aktualisierung der erwarteten Hashes und Tests.
