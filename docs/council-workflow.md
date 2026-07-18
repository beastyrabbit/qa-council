# Council-Workflow

## Verbindliche Quellen

Die acht Dateien unter `resources/qa/source` bleiben die hash-geprüften fachlichen Quellen. Die
RACI-Matrix enthält 37 serverseitig validierte Aktivitätszeilen. Modelltext kann weder Rollen noch
RACI-Verantwortung frei erfinden.

## Einheitlicher Ablauf

Quick, Standard und Deep durchlaufen dieselben Phasen:

1. Extraction
2. Evidence
3. Routing/RACI
4. isolierte Rollenreviews
5. anonyme Peer-Reviews und Ranking
6. gemeinsames Review
7. Pro/Contra-Debatte
8. Council-Runden
9. Synthese und Dissent-Audit
10. Reports

Der Modus verändert ausschließlich die Zahl der abschließenden Council-Runden: Quick führt eine,
Standard zwei und Deep drei Runden aus.

## Evidence und große Dokumente

Bis 110.000 Zeichen erhält das RACI-Routing den vollständigen Originaltext. Größere Dokumente
werden vollständig in geordnete Originalchunks zerlegt. Die Evidence-Phase führt dann keine
fachliche Modellanalyse pro Chunk aus, sondern baut einen dokumentweiten Hybridindex:

- exakte Begriffe und strukturelle Nachbarschaft;
- lokale AI-Box-Embeddings für Chunks, kleinere offsettreue Passagen und die 37 RACI-Zeilen;
- mögliche RACI-Aktivitäten und Rollen pro Chunk;
- semantische und lexikalische Beziehungen auch zwischen weit auseinanderliegenden Chunks;
- kurze, unveränderte Originalauszüge mit Locator und Chunk-Hash.

Die daraus erzeugten Belegkarten sind ausdrücklich nur Such- und Navigationshilfen. Sie dürfen
weder als Fachreview noch als Beleg übernommen werden. Der QA-Architekt prüft ihre Vorschläge
gegen Originalauszüge und Coverage-Manifest. Danach analysiert jede eingeladene Rolle jeden
vollständigen Originalchunk in einer isolierten Teilprüfung; die Belegkarte entscheidet nie,
welcher Text geprüft wird. Die rolleninterne Zusammenführung erhält zusätzlich das dokumentweite
Beziehungsmanifest und muss chunkübergreifende Aussagen mit allen beteiligten Locator belegen.

So bleibt beispielsweise eine gleichartige Prioritätsaussage in Chunk 1 und Chunk 20 auffindbar,
ohne beide Texte vorab zu einem scheinbaren Fachbefund zu verdichten. Embeddings dienen dabei
ausschließlich der Navigation. Bei deaktiviertem oder nicht erreichbarem Embedding-Modell läuft
dieselbe Phase mit exakten Begriffen und strukturellen Beziehungen weiter.

Jede eingeladene A-, R- oder benötigte C-Rolle erstellt genau ein isoliertes Review. Danach
bewertet jede Rolle alle fremden, anonymisierten Reviews. `submit_peer_review` enthält nur die
vollständige Rangfolge der erlaubten Review-IDs und einen ganzzahligen Consensus von 1 bis 5; die
inhaltliche Kritik bleibt Markdown.

- Eine Rolle: kein Peer-Ranking, Consensus 3,0 und niedrige Confidence.
- Zwei Rollen: gegenseitige Bewertung; ein Ranggleichstand wird über die stabile anonyme ID
  aufgelöst.
- Ab drei Rollen: jede Rolle rangiert alle fremden Reviews.

Alle A-, R- und C-Stimmen besitzen dasselbe Gewicht. Gesamtplatzierung und Consensus verwenden
jeweils das arithmetische Mittel.

## Strukturierte Steuerdaten

RACI-Routing und Peer-Ranking werden ausschließlich über Pi-Custom-Tools übertragen:

- `submit_council_plan`
- `submit_peer_review`

Ein tool-only Turn ist auf Provider-Ebene gültig. Genau ein schema- und semantikgültiger Submit wird
akzeptiert; beim Peer-Review bleibt zusätzlich die inhaltliche Markdown-Kritik verpflichtend.
Fehlende, doppelte oder ungültige Aufrufe beziehungsweise eine fehlende Peer-Kritik erhalten
höchstens zwei Reparaturversuche in jeweils neuen, stateless Pi-Sessions. Es gibt keinen JSON- oder
Text-Fallback.

Vor der Extraction muss das gewählte Modell Tool-Support in seinen Metadaten ausweisen und einen
kleinen Submit-Probe bestehen. Das Ergebnis wird je Provider, Modell, Endpoint und
Tool-Schema-Version 24 Stunden gespeichert.

## Attempts und Checkpoints

Jeder Lauf beginnt mit Attempt 1. Manueller Restart erzeugt atomar einen neuen Attempt; Antworten
auf Ground-or-Ask und Startup-Recovery bleiben im aktuellen Attempt. Stages, Events, Artefakte,
Presentations, Bilder, Rückfragen und abgeleitete Analysen tragen eine `attempt_no`.

Jede der zehn Phasen schreibt erst nach Erfolg einen versionierten Checkpoint mit Input-Hash und
Output-Referenzen. Dokument und Extraction-Cache sind attemptübergreifend; Analyse- und
Reportausgaben bleiben attemptgebunden. Frühere Attempts werden nicht verändert und sind in der
Laufansicht auswählbar.

## Finales Audit-Ergebnis

Das kanonische Markdown besitzt getrennte Abschnitte:

1. `## Finale Synthese`
2. `## Triage und RACI`
3. `## Isolierte Einzelreviews`
4. `## Cross-Reviews`
5. `## Gemeinsames Review`
6. `## Debattenprotokoll`
7. `## Council-Runden`
8. `## Dissent-Audit`
9. `## Abdeckungsmanifest`

Tageszeitung und Visual Report erhalten für diese Bereiche eigenständige Seiten. Die normale
Resultatansicht zeigt nur die finale Synthese. Vollständige Einzelartefakte werden ausschließlich
im Dateireader geöffnet.
