# QA Council

QA Council prüft hochgeladene Dokumente mit einem nachvollziehbaren Multi-Rollen-Workflow auf Basis des Pi SDK. Die acht gelieferten QA-Quelldateien liegen unverändert unter `resources/qa/source`. Der eigene Report-Designer liegt unter `resources/skills/report-designer`. Beide Quellen werden vor ihrer Verwendung gegen fest eingebaute SHA-256-Werte geprüft.

## Funktionsumfang

- sofortiger Upload ohne Vorabextraktion; sichtbare, resumierbare Seitenextraktion als erster
  Lauf-Schritt mit Tika, PDF-Layout, Codex-Bildbeschreibung und Hash-Cache
- lückenlose Chunk-Verarbeitung mit Locator, Hash und Coverage-Manifest
- Anbieterwahl zwischen serverseitigem Codex-OAuth, OpenRouter und lokaler Ollama-kompatibler AI Box
- Council-Modi Auto, Quick, Standard und Deep
- Triage/RACI, isolierte Rollenreviews, Cross-Reviews, Debatte und Synthese gemäß den kanonischen Quellen
- persistentes Detailprotokoll ohne Speicherung versteckter Gedankengänge
- finales Markdown als kanonisches Ergebnis; danach eine sichtbare Report-Design-Modellstufe, die pro Lauf eine individuelle mehrseitige HTML-Tageszeitung und einen diagrammreichen Visual Report von Grund auf erzeugt
- dokumentbezogene Illustration pro Lauf über OpenAI, ein bildfähiges OpenRouter-Modell oder ComfyUI; stabile Ergebnis-/Unterseiten-URLs und A4-PDF-Export
- eigene Dokument- und Archivbereiche mit erneutem Prüfen, Archivieren aller abgeschlossenen Läufe und gezieltem Löschen fehlgeschlagener Läufe
- eigener Testmodus für parallele, voneinander getrennte Vergleiche von Codex, OpenRouter und AI Box mit individueller Modellauswahl und durchsuchbaren Modelllisten
- statische Schlussprüfung des erzeugten Report-Packages auf HTML-Struktur, unbekannte CSS-Klassen und unerlaubtes JavaScript; nur bei Befunden folgt genau eine sichtbare Agent-Korrekturstufe
- SQLite/Drizzle auf einem persistenten Volume; Modellartefakte bleiben virtuelle Datenbankobjekte

## Dokumentation

Die vollständige Projektdokumentation beginnt unter [docs/README.md](docs/README.md). Sie beschreibt Architektur, Council-Regeln, Provider, Betrieb, Sicherheit und das Homelab-Deployment.

## Lokal entwickeln

Voraussetzungen sind Node.js 24+, pnpm und Portless. Die API läuft intern auf Port 3001, Vite wird von Portless unter einer stabilen URL bereitgestellt.

```bash
pnpm install
portless
```

Anschließend ist die Oberfläche unter `http://qa-council.localhost:1355` erreichbar, wenn Portless auf den unprivilegierten Standardport zurückfällt. Für binäre Dokumente muss zusätzlich Tika erreichbar sein, beispielsweise mit `docker compose up tika`.

## Konfiguration

- Codex: in der Einstellungsseite anmelden; das Pi-Auth-File liegt unter `/data/pi/auth.json`. Als manueller Fallback kann im Container `pi /login` verwendet werden.
- OpenRouter: API-Key in der Einstellungsseite oder über `OPENROUTER_API_KEY`.
- AI Box: optional konfigurierbare Ollama-Adresse; Modellliste über `/api/tags`, Inferenz über `/v1`.
- `TIKA_URL`: Standard `http://127.0.0.1:9998`.
- `DATA_DIR`: Standard `./data`, im Container `/data`.

## Qualitätsprüfung

```bash
pnpm check
```

Dies führt Biome, TypeScript, Vitest und den Produktionsbuild aus. Der Pre-Commit-Hook ergänzt Gitleaks.
Die automatisierte Testsuite ist offline und startet keine Live-KI-Analyse; ein manueller
Provider-Abnahmelauf erfordert immer eine ausdrückliche Benutzeranweisung für genau diesen Lauf.

Das Projekt verwendet absichtlich zwei TypeScript-Pakete: das aktuelle `typescript` für App und
Typecheck sowie den stabilen Alias `typescript-compiler` für die statische Prüfung generierter
Report-Manifeste.

## Deployment

Das Container-Image wird von Forgejo Actions über den gemeinsamen BuildKit- und Registry-Login-Workflow als `git.heerlab.com/beasty/qa-council` veröffentlicht. Die GitOps-Manifeste liegen im separaten `kub-homelab`-Repository unter `cluster/homelab/apps/tools/qa-council`.
