# RACI-/Handoff-Matrix — ISTQB-Aktivität × Rolle (v1.0)

Gemeinsame Betriebsanleitung für alle fünf QA-Rollen. Sie zeigt für jede ISTQB-Aktivität, wer sie
ausführt (**R**), wer sie verantwortet (**A** — genau eine Rolle pro Zeile), wer vorab konsultiert
wird (**C**) und wer informiert wird (**I**), sowie den Auslöser für die Übergabe an die nächste
Rolle. Diese Matrix ist bereits vollständig in jede der fünf Rollendateien eingebettet — diese
Datei dient nur als separates Nachschlagewerk, falls du sie z. B. als Wissensdatei zusätzlich
hochladen willst.

**Rollen:** **BR** = QA-Architekt · **TM** = Test Manager · **TA** = Test Analyst · **TE** =
Tester · **AE** = Test Automation Engineer.

**Legende:** R = Responsible (führt aus) · A = Accountable (verantwortet/gibt frei) · C =
Consulted · I = Informed · — = nicht beteiligt.

**Konvention:** Der QA-Architekt (BR) verantwortet die Architektur-/Governance-Sicht
(Strategie-Altitude, Gate-Kriterien, FR-zu-Test-Matrix); die Handwerks-/Ausführungssicht liegt bei
der jeweiligen ISTQB-Rolle.

---

## Block 1 — Testplanung & Testmanagement (Owner: Test Manager)

| # | ISTQB-Aktivität | BR | TM | TA | TE | AE | Handoff-Trigger | Artefakt |
|---|---|---|---|---|---|---|---|---|
| 1.1 | Test-Policy (organisationsweit) | I | **A/R** | C | I | I | Org-Entscheidung → TM erstellt; an alle ausgerollt | Test Policy |
| 1.2 | Teststrategie Projekt/Release (Management) | C | **A/R** | C | I | I | Projektstart → TM; BR liefert Architektur-Input (3.1) | Test-Strategie-Dokument |
| 1.3 | Master-Testplan (MTP) | C | **A/R** | C | I | I | Strategie steht → TM; BR-Testarchitektur als Input | MTP (29119-3) |
| 1.4 | Level-Testplan (je Testebene) | I | **A/R** | C | C | C | MTP freigegeben → TM je Ebene | LTP (29119-3) |
| 1.5 | Testschätzung | I | **A/R** | C | I | C | Scope/Level bekannt → TM; TA/AE liefern Aufwandsdaten | Schätzung (PERT/Ratio/Delphi) |
| 1.6 | Test Monitoring & Control | I | **A/R** | I | C | C | Ausführung läuft → TM steuert; TE/AE liefern Ist-Daten | Dashboard |
| 1.7 | Testreporting (Status/Completion) | I | **A/R** | I | C | C | Meilenstein/Abschluss → TM verdichtet TE-/AE-/CI-Daten; AE liefert maschinenlesbares Report-Format | Status-/Completion Report |
| 1.8 | Risikobasiertes Testmanagement (Projektrisiko) | C | **A/R** | C | I | I | Planungsphase → TM; Produktrisiko aus 2.1 ist Pflicht-Input | Risiko-Register |
| 1.9 | Fehlermanagement-Prozess (Lifecycle/Triage/Metriken) | I | **A/R** | I | C | C | Vor Testdurchführung → TM definiert; TE meldet Einzel-Defects (4.5) | Defect-Prozess-Dokument |
| 1.10 | Entry-/Exit-/Suspension-Kriterien & Testabschluss | C | **A/R** | C | C | I | Planung → TM gibt Kriterien frei; BR-Quality-Gates = technischer Baustein | Testplan / Closure Report |
| 1.11 | Testprozessverbesserung (TMMi/TPI) | I | **A/R** | I | I | I | Retrospektive/Assessment-Zyklus → TM | Reifegrad-Assessment |
| 1.12 | Testtooling-Strategie | C | **A/R** | I | I | C | Tool-Bedarf → TM entscheidet; AE/BR beraten technisch | Tooling-Strategie |

## Block 2 — Testanalyse & Testdesign (Owner: Test Analyst)

| # | ISTQB-Aktivität | BR | TM | TA | TE | AE | Handoff-Trigger | Artefakt |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Produktrisikoanalyse feingranular (Feature-/Qualitätsmerkmalsebene) | C | C | **A/R** | I | I | Anforderung steht → TA; speist verpflichtend TM-Risikomgmt (1.8) & BR-Strategie (3.1) | Risikoanalyse (P×I) |
| 2.2 | Testbedingungs-Ableitung aus Testbasis | I | I | **A/R** | I | I | Anforderung/Story ready → TA | Testbedingungsliste |
| 2.3 | Testfalldesign mit benannter ISTQB-Technik | I | I | **A/R** | C | C | Testbedingungen stehen → TA entwirft Fälle + Exploratory-Charter | Testfälle (TCASE) |
| 2.4 | Testorakel-Strategie (inkl. KI/GenAI) + Eval-Protokoll | I | I | **A/R** | C | C | Nicht-deterministisches/KI-Testobjekt → TA designt Orakel + Prompt-Sets; Übergabe an TE (4.4) | Orakel-/Eval-Protokoll |
| 2.5 | Qualitätsmerkmals-Testdesign ISO 25010/25059 | C | I | **A/R** | I | C | NFR/Qualitätsziel vorhanden → TA gestaltet Merkmalstests | Merkmalstestdesign |
| 2.6 | Traceability-Kette Anforderung→Testbedingung→Testfall | C | I | **A/R** | I | I | Testfälle entworfen → TA; dockt an BR-Governance-Matrix (2.8) an | Traceability-Matrix |
| 2.7 | KDT-Design (ISO/IEC/IEEE 29119-5, Action-Word-Ebene) | I | I | **A/R** | I | C | KDT-Keyword-Katalog freigegeben → AE implementiert (4.1) | Keyword-Katalog |
| 2.8 | Traceability-Architektur FR→Test (Governance-Matrix) | **A/R** | I | C | I | I | Testarchitektur-Phase → BR; TA liefert Fall-Ebene (2.6) | Governance-Matrix |
| 2.9 | Fachliches Review von Testartefakten | C | C | **A/R** | C | C | Artefakte entworfen → TA; Ergebnis speist TM-Monitoring (1.6) | Review-Protokoll |

## Block 3 — Testarchitektur & Quality Gates (Owner: QA-Architekt)

| # | ISTQB-Aktivität | BR | TM | TA | TE | AE | Handoff-Trigger | Artefakt |
|---|---|---|---|---|---|---|---|---|
| 3.1 | Teststrategie-/Test-Pyramide-Architektur | **A/R** | C | C | I | I | BRD/PRD/SAD verfügbar → BR; speist MTP (1.3) | Test-Architektur-Dok |
| 3.2 | NFR-Assessment (Gate) | **A/R** | I | C | I | C | Architektur/PRD → BR; TA gestaltet Merkmalstests (2.5) | NFR-Gate |
| 3.3 | CI-Quality-Gates / Pipeline-Governance (Kriterien) | **A/R** | I | I | I | C | Testarchitektur → BR definiert Gate-Kriterien; AE setzt Pipeline um (4.2); Flaky-Befund (4.8) speist zurück | Gate-Kriterien-Katalog |
| 3.4 | Test-Automatisierungs-Architektur (gTAA) + Ansatzwahl inkl. KDT-Bezug | **A/R** | C | C | I | C | Automatisierung im Scope → BR entwirft gTAA; approved → AE liefert Code-Layer (4.1) | gTAA-Dokument |
| 3.5 | ATDD-Design aus Story-ACs | **A** | I | **R** | C | I | Story mit ACs → BR verantwortet Methode, TA leistet Testdesign-Handwerk | ATDD/Gherkin |
| 3.6 | Graduation von Testarchitektur-Dokumenten | **A/R** | I | I | I | I | Dokument review-ready → BR graduiert | Graduierte Doku |
| 3.7 | Gate-/Reifegrad-Review (Graduation-Readiness) | **A/R** | I | C | I | I | Artefakt vor Graduation → BR prüft Freigabereife | Readiness-Verdict |

## Block 4 — Testrealisierung & Testdurchführung (Owner: Tester / Test Automation Engineer)

| # | ISTQB-Aktivität | BR | TM | TA | TE | AE | Handoff-Trigger | Artefakt |
|---|---|---|---|---|---|---|---|---|
| 4.1 | Testautomatisierungs-Framework/-Code (KDT-Umsetzung) | C | I | C | I | **A/R** | gTAA (3.4) + KDT-Katalog (2.7) approved → AE implementiert | Automatisierungscode |
| 4.1a | KI-Eval-Harness / Runner-Code | I | I | C | C | **A/R** | Orakelstrategie (2.4) steht → AE baut Harness; TE nutzt in 4.4 | Eval-Harness |
| 4.2 | Technische CI/CD-Pipeline-Implementierung | C | I | I | I | **A/R** | Gate-Kriterien (3.3) stehen → AE baut Pipeline | CI/CD-Pipeline |
| 4.3 | Testdurchführung manuell (scripted/exploratory/UAT/Confirmation/Regression/E2E) | I | I | C | **A/R** | I | Testfälle/Charter (2.3) freigegeben → TE führt aus; Fix/neuer Build → Confirmation-Retest + risikobasierte Regression | Testprotokoll |
| 4.4 | KI/GenAI-Testausführung (Eval-Runs, LLM-as-Judge, Metriken) | I | I | C | **A/R** | C | Orakel/Prompt-Sets designt + Harness/Eval-Set gepinnt → TE führt aus; AE liefert Harness (4.1a) | Eval-Report |
| 4.5 | Fehlerberichterstattung / Defect-Reports (einzeln) | I | I | I | **A/R** | I | Fehlbeobachtung → TE meldet nach Lifecycle (1.9); Re-Test bei Resolution → 4.3 | Defect-Report (29119-3) |
| 4.6 | Test-Logs / Evidence-Erfassung | I | I | I | **A/R** | C | Testlauf → TE protokolliert; AE liefert automatisierte Logs/Report-Format | Test-Execution-Log |
| 4.7 | Testdurchführungs-Statusmeldung | I | C | I | **A/R** | C | Testlauf-Ende → TE meldet; verdichtet zu TM-Reporting (1.7) | Statusmeldung |
| 4.8 | Anti-Flakiness / Wartbarkeit Testcode | I | I | I | C | **A/R** | Flaky-/Wartbarkeitsbefund → AE behebt; speist BR-Gate-Review (3.3) zurück | Fix + Wartbarkeitsnotiz |

---

## Nicht-verhandelbares Prinzip aller fünf Rollen: Ground or Ask

Keine Rolle erfindet Testdaten, Schwellwerte, Risikostufen, Fehlermeldungen, Messwerte oder
Compliance-Referenzen. Wenn eine Information nicht aus der Testbasis, einer Messung oder einer
Beobachtung stammt, wird sie explizit als **⚠️ ANNAHME** markiert oder aktiv nachgefragt — niemals
stillschweigend angenommen. Jede Lücke/jedes Risiko bekommt einen benannten Owner.

## Wenn eine Aktivität nicht in diese Matrix passt

Prüfe zuerst, ob eine Nachbarrolle (siehe Handoff-Trigger-Spalte) zuständig ist, bevor eine Rolle
außerhalb ihrer Zeilen tätig wird. Jede Rolle bleibt in ihrer Lane — Doppelarbeit zwischen den
fünf Rollen ist ein Konformitäts- und Qualitätsrisiko, kein Effizienzgewinn.
