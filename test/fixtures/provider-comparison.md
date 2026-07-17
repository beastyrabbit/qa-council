# Release-Kandidatenprüfung: Kundenportal 2.4

## Ziel

Das Kundenportal soll am 22. Juli 2026 veröffentlicht werden. Der Release umfasst einen neuen
Rechnungsdownload, die Änderung der E-Mail-Adresse und eine überarbeitete Sitzungsverwaltung.

## Abnahmekriterien

1. Rechnungen können als PDF geladen werden. Der Download muss für die letzten 24 Monate verfügbar
   sein.
2. Eine geänderte E-Mail-Adresse wird erst nach Bestätigung eines Links aktiv. Der Link ist
   30 Minuten gültig.
3. Nach einer Passwortänderung werden alle anderen Sitzungen innerhalb von fünf Minuten beendet.
4. Die Oberfläche unterstützt aktuelle Versionen von Chrome, Firefox und Safari sowie mobile
   Ansichten ab 360 Pixel Breite.

## Bekannter Stand

- Die fachlichen Happy-Path-Tests sind abgeschlossen.
- Für abgelaufene Bestätigungslinks existiert noch kein automatisierter Test.
- Die Sitzungsbeendigung wurde in einer Staging-Umgebung mit einem einzelnen Benutzer geprüft.
- Eine Lastprüfung des Rechnungsdownloads wurde noch nicht durchgeführt.
- Das Produktteam hat keine messbare maximale Downloadzeit festgelegt.

## Entscheidung

Das QA Council soll eine Release-Empfehlung, priorisierte Risiken, konkrete nächste Schritte und
die fehlenden Nachweise benennen. Unbelegte Annahmen müssen als offene Punkte sichtbar bleiben.
