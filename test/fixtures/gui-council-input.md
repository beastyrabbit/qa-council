# Release Readiness Review: Kundenportal 2.4

## Ausgangslage

Das Kundenportal soll am 30. September produktiv gehen. Der Scope umfasst Anmeldung,
Vertragsübersicht, PDF-Rechnungen und die Änderung der Bankverbindung. Verantwortlich für die
Freigabe ist das Produktteam; eine dokumentierte RACI-Zuordnung fehlt.

## Qualitätsrisiken

1. Für die Änderung der Bankverbindung gibt es keinen negativen Berechtigungstest.
2. Der Barrierefreiheitstest deckt nur die Startseite ab.
3. Die Wiederherstellungszeit nach einem Datenbankausfall wurde nicht gemessen.
4. Zwei Browser-End-to-End-Tests sind instabil und werden derzeit manuell neu gestartet.
5. Die Datenschutzfreigabe verweist auf Version 2.2 des Datenflussdiagramms.

## Vorhandene Nachweise

| Bereich | Nachweis | Stand |
| --- | --- | --- |
| Anmeldung | 38 automatisierte Tests | bestanden |
| Rechnungen | Stichprobe mit 12 PDFs | bestanden |
| Bankdaten | Happy-Path-Test | bestanden |
| Performance | 450 gleichzeitige Sessions | p95 780 ms |
| Recovery | Runbook | ungeprüft |

## Offene Entscheidung

Das Produktteam schlägt eine Freigabe mit manueller Überwachung vor. Security fordert vor der
Freigabe einen negativen Autorisierungstest. Operations akzeptiert das Runbook erst nach einem
Wiederherstellungstest. Es ist nicht dokumentiert, wer den verbleibenden Datenschutzbefund
schließt oder welche Abnahmekriterien dafür gelten.
