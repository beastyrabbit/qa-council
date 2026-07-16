# Provider und Modelle

Die Provider-Einstellungen befinden sich in der Weboberfläche unter **Einstellungen**. Für jeden Provider kann die Modellliste durchsucht und ein Standardmodell gespeichert werden.

## Serverseitiges Codex

Interner Providername im Pi SDK: `openai-codex`.

- Authentifizierung über die eingebaute Pi-OAuth-Implementierung
- Zugang wird unter `${DATA_DIR}/pi/auth.json` gespeichert
- die Datei liegt im Kubernetes-Betrieb auf dem persistenten Volume
- die Einstellungsseite startet einen Device-Code- oder Browser-Login
- bei einem nicht unterstützten interaktiven Schritt lautet der manuelle Fallback im Container: `pi /login`

Das OAuth-File darf nicht in Git, Logs oder Backups ohne Verschlüsselung gelangen. Es muss auf dem Persistent Volume nur für den Containerbenutzer lesbar sein.

## OpenRouter

- API-Basis: `https://openrouter.ai/api/v1`
- Modellkatalog aus dem eingebauten Pi-Modellregister
- Authentifizierung über `OPENROUTER_API_KEY` oder einen in der Einstellungsseite hinterlegten Key
- ein in der Oberfläche gespeicherter Key wird AES-256-GCM-verschlüsselt
- eine Umgebungsvariable hat den Vorteil, vollständig von Infisical verwaltet zu werden

Im Homelab wird `OPENROUTER_API_KEY` aus dem Kubernetes Secret `qa-council-secret` injiziert. Dessen kanonische Quelle ist:

```text
Projekt: Kub-Homelab
Umgebung: prod
Pfad: /kubernetes/tools/qa-council-secret
```

## Lokale AI Box

Standardadresse:

```text
http://192.168.10.120:11434
```

Verwendete Schnittstellen:

- `GET /api/tags` für die Modellliste
- `/v1` als OpenAI-kompatible Inferenzbasis

Das Standardmodell bei einer neuen Datenbank ist `qwen3-coder-next:q4km`. Die Einstellungsseite zeigt die tatsächlich von `/api/tags` gelieferten Modelle. Ist die AI Box nicht erreichbar, bleibt das gespeicherte Modell auswählbar und wird als nicht erreichbar gekennzeichnet.

Für lokale Ollama-Inferenz wird kein echter API-Key benötigt. Intern verwendet die Pi-Konfiguration einen nicht geheimen Platzhalter, weil die OpenAI-kompatible Schnittstelle ein Key-Feld erwartet.

## Session-Konfiguration

Alle drei Provider werden identisch abgesichert:

- keine Agentenwerkzeuge
- In-Memory-Session
- keine Projektdatei- oder Skill-Autodiscovery
- expliziter, hash-geprüfter Systemprompt
- deaktivierte Kontextkompaktierung
- begrenzte automatische Retries
- Thinking-Inhalte werden nicht in das Benutzerprotokoll übernommen

## Providerwahl pro Lauf

Ein Lauf speichert Provider und Modell unveränderlich. Eine spätere Änderung der Einstellungen ändert bestehende Läufe nicht. Zusätzliche Präsentationen verwenden den Provider und das Modell des ursprünglichen Laufs, damit Herkunft und Kosten nachvollziehbar bleiben.
