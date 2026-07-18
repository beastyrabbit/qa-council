# QA Council – Dokumentation

QA Council ist eine Webanwendung für nachvollziehbare, mehrstufige Qualitätsprüfungen von Dokumenten. Ein hochgeladenes Dokument wird von einem rollenbasierten QA Council geprüft. Das vollständige fachliche Ergebnis entsteht immer zuerst; HTML/Text, QA-Tageszeitung und Visual Report werden anschließend als separate Darstellungen daraus erzeugt.

## Dokumentationsübersicht

| Dokument | Inhalt |
|---|---|
| [Architektur](architecture.md) | Komponenten, Datenfluss, Datenbank und API |
| [Council-Workflow](council-workflow.md) | Skill-Integrität, Rollen, Modi und Ergebnisaufbau |
| [Provider und Modelle](providers.md) | Codex, OpenRouter und lokale AI Box |
| [Betrieb](operations.md) | Lokale Entwicklung, Konfiguration, Backups und Fehleranalyse |
| [Deployment](deployment.md) | Forgejo, Container, Kubernetes, Infisical und Pangolin |

## Kernprinzipien

1. **Keine stillen Auslassungen:** Jede Quelldatei und jeder Dokument-Chunk erhält einen Hash und einen nachvollziehbaren Verarbeitungsnachweis.
2. **Kanonisches Ergebnis zuerst:** Die Präsentationsform beeinflusst die fachliche Prüfung nicht.
3. **Rollen bleiben getrennt:** Einzelreviews werden isoliert erzeugt, bevor Cross-Reviews oder Debatten stattfinden.
4. **Ground-or-Ask:** Fehlt eine zwingend notwendige Grundlage, hält der Lauf an und fordert eine Antwort an.
5. **Auditierbarkeit:** Stufen, Events, Artefakte, verwendete Modelle und Prompt-/Skill-Hashes werden persistiert.
6. **Keine versteckten Gedankengänge:** Das Detailprotokoll zeigt Vorgänge und Ergebnisse, speichert aber keine internen Thinking-Deltas.

## Unterstützte Eingaben

- Text, Markdown, JSON, YAML, XML, CSV, HTML und Logdateien
- PDF
- Word, Excel und PowerPoint einschließlich älterer Formate
- OpenDocument
- RTF und MSG

Der Upload speichert zunächst ausschließlich das Original. Die Extraktion startet sichtbar als
erster Schritt nach **Go**. Textformate werden direkt gelesen; Binärformate nutzen Tika sowie eine
begrenzte seitenweise Layout- und Bildanalyse. Fertige Seiten und vollständige Ergebnisse werden
persistiert und per Dokument-Hash wiederverwendet. Die initiale Uploadgrenze beträgt 50 MiB.

## Ergebnisse

- **HTML / Nur Text:** vollständiges, bereinigtes HTML des finalen Markdown-Ergebnisses; das Markdown kann heruntergeladen werden.
- **QA-Tageszeitung:** ruhige, warme „Velvet Green Room“-Titelseite plus eigenständige
  Ressortseiten im flaschengrünen Papier-/Messing-Design.
- **Visual Report:** warme „Group Chat“-Publikation mit belegten Gesprächsbubbles,
  Prozessbildern, Matrizen, nächsten Schritten und PDF-Export.

Weitere Darstellungen können nach einem abgeschlossenen Lauf erzeugt werden, ohne den Council erneut auszuführen.
