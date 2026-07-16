# QA-Rollen-Set — portable System-Prompts für beliebige LLMs

Dieses Paket enthält sechs ISTQB-orientierte QA-Rollen, aufbereitet als eigenständige,
plattformneutrale System-Prompts. Jede Datei ist unabhängig von den anderen nutzbar — du kannst
eine einzelne Rolle in ein beliebiges Chat-LLM einfügen, ohne die übrigen Dateien mitzuliefern.

## Dateien

| Datei | Rolle | Wofür |
|---|---|---|
| `01_QA-Architekt.md` | QA-Architekt | Teststrategie/-pyramide, Quality Gates, NFR-Gates, gTAA-Entwurf, Governance |
| `02_Test-Manager.md` | Test Manager | Testplanung, -steuerung, -berichterstattung, Prozessreife, Automatisierungsstrategie |
| `03_Test-Analyst.md` | Test Analyst | Testanalyse, Testfalldesign mit benannter Technik, Testorakel-Strategie |
| `04_Test-Automation-Engineer.md` | Test Automation Engineer | Automatisierungsarchitektur (gTAA-Umsetzung), Code, CI/CD, Anti-Flakiness |
| `05_Tester.md` | Tester | Tatsächliche Testdurchführung, Defect-Reports, Evidence, Statusmeldung |
| `06_QA-Council.md` | Orchestrator | Mehrrollen-Review mit isolierten Einzelmeinungen, Cross-Review, Debatte, Synthese |
| `07_RACI-Team-Matrix.md` | Referenz | Gemeinsame Zuständigkeits-/Handoff-Matrix aller fünf Rollen (bereits in jede Rollendatei eingebettet — separat nur als Nachschlagewerk) |

## Wie einbinden

**ChatGPT (Custom GPT) / Gemini (Gem) / Claude (Projekt-Anweisungen) / jedes System mit
"System-Prompt" oder "Custom Instructions"-Feld:** Öffne die gewünschte Rollendatei, kopiere den
gesamten Inhalt (ohne diese README) und füge ihn als System-Prompt bzw. Instructions-Feld ein.

**Einfacher Chat ohne Custom-Instructions-Feld (z. B. Konversationsstart):** Füge den Inhalt der
Rollendatei als erste Nachricht ein, z. B. mit dem Zusatz "Handle ab jetzt gemäß dieser
Rollenbeschreibung."

**Mehrere Rollen gleichzeitig in einem Tool (z. B. Custom-GPT-Wissensdateien):** Alle sechs
Dateien hochladen; jede Rollendatei bleibt trotzdem für sich lesbar.

## Was verändert wurde gegenüber dem Original

- Keine Referenzen mehr auf ein "Skill"-Ladesystem, Werkzeuge oder Dateipfade wie
  `references/x.md` — alle Inhalte (Vorlagen, RACI-Matrix, Quellenbasis) sind direkt in die
  jeweilige Rollendatei eingebettet.
- Der QA-Council (`06_QA-Council.md`) wurde vom Original-Mechanismus (parallele Unter-Agenten
  über ein Werkzeug, persistente Journal-Datei) auf zwei plattformunabhängige Betriebsarten
  umgestellt: Mehrere-Chats-Modus (echte Isolation, wenn dein Tool mehrere Sitzungen erlaubt) und
  Einzel-Chat-Simulationsmodus (schwächere, aber praktikable Isolation). Die automatische
  Lessons-/Journal-Selbstlernschleife des Originals ist als optionaler, manuell geführter
  Abschnitt erhalten, aber nicht mehr technisch erzwungen.
- Fachinhalt (Kompetenzbereiche, Techniken, Vorlagen, Ground-or-Ask-Prinzip, RACI-Matrix) ist
  unverändert übernommen.

## Kompatibilitätshinweis

Diese Prompts sind bewusst textbasiert und ohne Tool-Aufrufe geschrieben. Rollen, die im Original
auf externe Aktionen angewiesen waren (z. B. automatisiertes Ausführen von Testcode), erwarten in
dieser Fassung, dass entweder du die Ausführung lieferst (Copy-Paste von Ergebnissen/Logs in den
Chat) oder das Ziel-LLM über eigene Tool-/Code-Ausführung verfügt.
