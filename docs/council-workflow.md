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
- eine kompakte, extraktive Chunk-Zusammenfassung aus mehreren unveränderten Originalauszügen
  vom Anfang, aus der Mitte, vom Ende und aus RACI-relevanten Passagen;
- Locator und Chunk-Hash für jede Zusammenfassung.

Die daraus erzeugten Belegkarten sind ausdrücklich nur Such- und Navigationshilfen. Sie dürfen
weder als Fachreview noch als Beleg übernommen werden. Der QA-Architekt prüft ihre Vorschläge
gegen Originalauszüge und Coverage-Manifest. Danach erhält jede eingeladene Rolle genau ein
dokumentweites Briefing. Es enthält sämtliche Chunk-Zusammenfassungen in Originalreihenfolge,
die direkt zugewiesenen RACI-Aktivitäten, weitere rollenspezifische Hinweise und das
dokumentweite Beziehungsmanifest. Auf dieser Grundlage erzeugt die Rolle genau ein isoliertes
Review des vollständigen Dokuments. Es gibt keine Einzelreviews pro Chunk und keinen
rolleninternen Merge zusätzlicher Teilreviews.

So bleibt beispielsweise eine gleichartige Prioritätsaussage in Chunk 1 und Chunk 20 auffindbar,
und beide Originalauszüge gelangen gemeinsam in das Rollenbriefing. Weder Embeddings noch
RACI-Scores werden dabei zu einem scheinbaren Fachbefund verdichtet. Sie dienen ausschließlich
der Navigation. Bei deaktiviertem oder nicht erreichbarem Embedding-Modell läuft dieselbe Phase
mit exakten Begriffen und strukturellen Beziehungen weiter.

Jede eingeladene A-, R- oder benötigte C-Rolle erstellt genau ein isoliertes Review. Danach
bewertet jede Rolle alle fremden, anonymisierten Reviews. `submit_peer_review` enthält nur die
vollständige Rangfolge der erlaubten Review-IDs und einen ganzzahligen Consensus von 1 bis 5; die
inhaltliche Kritik bleibt Markdown. Dafür laufen pro Rolle bewusst zwei getrennte, stateless
Stufen: `Cross-Review` schreibt zuerst ausschließlich die fachliche Markdown-Kritik.
`Cross-Ranking` überträgt anschließend genau diese fertige Kritik in einen tool-only
`submit_peer_review`-Aufruf. So muss kein Modell gleichzeitig Fließtext und strukturierte
Steuerdaten in einer Antwort liefern.

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
akzeptiert. Beim Peer-Review entsteht die verpflichtende Markdown-Kritik bereits in der
vorhergehenden `Cross-Review`-Stufe; nur das anschließende `Cross-Ranking` ist tool-only. Fehlende,
doppelte oder ungültige Aufrufe erhalten höchstens zwei Reparaturversuche in jeweils neuen,
stateless Pi-Sessions. Es gibt keinen JSON- oder Text-Fallback.

Vor der Extraction muss das gewählte Modell Tool-Support in seinen Metadaten ausweisen und einen
kleinen Submit-Probe bestehen. Das Ergebnis wird je Provider, Modell, Endpoint und
Tool-Schema-Version 24 Stunden gespeichert.

## Attempts und Checkpoints

Jeder Lauf beginnt mit Attempt 1. Manueller Restart erzeugt atomar einen neuen Attempt; Antworten
auf Ground-or-Ask und Startup-Recovery bleiben im aktuellen Attempt. Stages, Events, Artefakte,
Presentations, Bilder, Rückfragen und abgeleitete Analysen tragen eine `attempt_no`.

Jede der zehn Phasen schreibt erst nach Erfolg einen versionierten Checkpoint mit
`analysis_version`, Input-Hash und Output-Referenzen. Die Analyseversion entspricht dem
QA-Council-Release. Nach einem Releasewechsel werden alte Checkpoints, Extraktionen,
Retrieval-Passagen und Embeddings nicht wiederverwendet; das Dokument wird unter der neuen
Version neu analysiert. Analyse- und Reportausgaben bleiben attemptgebunden. Frühere Attempts
werden nicht verändert und sind in der Laufansicht auswählbar.

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

Diese Abschnitte bilden das unveränderte Audit, nicht die sichtbare Gliederung der Reports. Die
normale Resultatansicht zeigt die vollständige finale Synthese. Die Tageszeitung verdichtet
dieselbe Synthese auf einer Hauptseite und in fünf Ergebnisartikeln zu Urteil, Stärken, Risiken,
Maßnahmen und Belegen. Der Visual Report erklärt Urteil, Gründe, Risiken, Handlungen, Belege und
Restunsicherheit. Vollständige Einzelartefakte und interne Council-Schritte werden ausschließlich
im Dateireader geöffnet.

## Laufvisualisierung

Die Laufdetailseite stellt diese zehn Phasen als echte Ablaufgrafik dar. Sequenzielle Stufen und
Parallelgruppen werden aus den persistierten `run_stages` aufgebaut; die Grafik erfindet keine
Fortschrittsdaten. Ein Klick auf eine gestartete Stufe filtert das cursorbasierte
Aktivitätsprotokoll über deren `stageId` und zeigt damit den tatsächlichen Log dieses Agenten.
