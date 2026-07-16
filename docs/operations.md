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
https://qa-council.localhost:1355
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
| `AIBOX_URL` | `http://192.168.10.120:11434` | lokale Ollama-kompatible AI Box |
| `OPENROUTER_API_KEY` | nicht gesetzt | OpenRouter-Zugang |
| `SETTINGS_ENCRYPTION_KEY` | lokales Schlüssel-File | Schlüsselmaterial für gespeicherte Provider-Keys |

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

## Daten und Backups

Für eine vollständige Wiederherstellung müssen gemeinsam gesichert werden:

- `qa-council.sqlite`
- `qa-council.sqlite-wal` und `qa-council.sqlite-shm`, falls SQLite während des Backups läuft
- `settings.key`, sofern kein fester `SETTINGS_ENCRYPTION_KEY` verwendet wird
- `pi/auth.json`, falls die Codex-OAuth-Anmeldung wiederhergestellt werden soll

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

- Bei Textdateien Encoding und tatsächlichen Inhalt prüfen.
- Bei Binärformaten `TIKA_URL` und `/version` prüfen.
- Tika-Ressourcen und Pod-Logs prüfen.
- Das Dokument zeigt die Extraktionsfehlermeldung in der Dateiliste.

### Provider ist nicht konfiguriert

- Codex: OAuth in den Einstellungen starten oder `pi /login` im Container ausführen.
- OpenRouter: Infisical-Sync oder gespeicherten API-Key prüfen.
- AI Box: Erreichbarkeit von `/api/tags` und `/v1/models` prüfen.

### Lauf wartet auf Eingabe

Dies ist kein Fehler. Im Details-Panel steht die konkrete Ground-or-Ask-Frage. Nach Absenden der Antwort wird die Prüfung wieder aufgenommen.

### AI Box meldet Verbindungsfehler

```bash
curl -fsS http://192.168.10.120:11434/api/tags
curl -fsS http://192.168.10.120:11434/v1/models
```

Bei `no route to host` liegt ein Netzwerk- oder Hostproblem vor. Ein Modellwechsel behebt keine fehlende Route.

### Skill-Integritätsfehler

Die Anwendung startet eine Modellstufe absichtlich nicht, wenn ein kanonischer Hash abweicht. Änderungen an Skill-Dateien erfordern eine bewusste fachliche Prüfung und anschließend eine Aktualisierung der erwarteten Hashes und Tests.
