# Checkout-Service – QA-Testgrundlage

Dokument-ID: `CHK-QA-017`

Version: 1.4  
Status: Review  
Verantwortlich: Nora Neumann (Product Owner)  
Prüfdatum: 2026-07-17

> Ziel dieses Dokuments ist eine belegbare QA-Prüfung des Checkout-Service vor dem Pilotbetrieb.

## 1. Geltungsbereich

Der Checkout-Service übernimmt Warenkorbvalidierung, Preisberechnung, Zahlungsauslösung und
Bestellbestätigung für den deutschen Webshop. Mobile Apps und Gastbestellungen sind im Pilotbetrieb
enthalten. Abonnements und Marktplatzartikel sind ausdrücklich nicht Bestandteil des Releases.

## 2. Funktionale Anforderungen

| ID | Anforderung | Akzeptanzkriterium | Priorität |
| --- | --- | --- | --- |
| FR-01 | Ein Warenkorb darf höchstens 50 Positionen enthalten. | Position 51 wird mit HTTP 422 und Fehlercode `CART_LIMIT` abgewiesen. | Hoch |
| FR-02 | Preise werden unmittelbar vor der Zahlung neu berechnet. | Bei einer Preisänderung wird keine Zahlung ausgelöst und der Kunde sieht Alt- und Neupreis. | Kritisch |
| FR-03 | Jede erfolgreiche Bestellung erhält eine eindeutige Bestellnummer. | Zwei parallele Requests mit gleichem Idempotency-Key erzeugen genau eine Bestellung. | Kritisch |
| FR-04 | Fehlgeschlagene Zahlungen dürfen erneut versucht werden. | Maximal drei Versuche innerhalb von 15 Minuten; danach 30 Minuten Sperre. | Mittel |
| FR-05 | Eine Bestellbestätigung wird per E-Mail versendet. | Der Versand startet spätestens 60 Sekunden nach erfolgreichem Abschluss. | Mittel |

## 3. Qualitätsanforderungen

### 3.1 Leistung

- 95 % der Checkout-Aufrufe antworten in höchstens 800 ms.
- 99 % der Checkout-Aufrufe antworten in höchstens 1,5 s.
- Der geplante Pilot hat 40 Requests pro Sekunde; ein dokumentierter Lasttest fehlt.

### 3.2 Verfügbarkeit und Wiederanlauf

Das Ziel beträgt 99,9 % monatliche Verfügbarkeit. Für den Ausfall des Zahlungsdienstleisters ist ein
Retry mit exponentiellem Backoff vorgesehen. Die maximale Zahl automatischer Wiederholungen ist
nicht festgelegt. Ein Disaster-Recovery-Test wurde noch nicht terminiert.

### 3.3 Sicherheit und Datenschutz

- Kartendaten dürfen weder in Logs noch in Traces gespeichert werden.
- Personenbezogene Daten werden nach 30 Tagen aus technischen Logs gelöscht.
- Die Rollen `support`, `finance` und `admin` dürfen Bestellungen einsehen.
- Eine dokumentierte Berechtigungsmatrix und ein Penetrationstest fehlen.

Beispiel eines erwarteten, redigierten Log-Eintrags:

```json
{
  "event": "payment_authorized",
  "order_id": "ORD-2026-00042",
  "payment_token": "[REDACTED]",
  "duration_ms": 418
}
```

## 4. Schnittstellen

Der Service nutzt:

1. Pricing API (`GET /v2/prices`)
2. Payment API (`POST /v1/authorizations`)
3. Order Store (PostgreSQL 16)
4. Notification Queue (`checkout.confirmed`)

Für die Pricing API ist ein Timeout von 500 ms definiert. Für Payment API und Notification Queue
fehlen Timeout-, Retry- und Circuit-Breaker-Werte.

Weiterführende Referenz: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

## 5. Bekannte Risiken

| Risiko | Wahrscheinlichkeit | Auswirkung | Maßnahme | Owner |
| --- | --- | --- | --- | --- |
| Doppelbestellung bei Client-Retry | Mittel | Kritisch | Idempotency-Integrationstest | Test Automation |
| Preisänderung während Zahlung | Hoch | Hoch | Race-Condition-Test | Test Analyst |
| Payment-Dienst nicht erreichbar | Mittel | Hoch | Fehler- und Wiederanlauftest | Test Manager |
| Unredigierte Zahlungsdaten im Log | Niedrig | Kritisch | Log-Sicherheitsprüfung | Security |

## 6. Teststatus

- [x] Unit-Tests für Warenkorbgrenze vorhanden
- [x] API-Schema im Repository versioniert
- [ ] Lasttest durchgeführt
- [ ] Recovery-Test durchgeführt
- [ ] Penetrationstest durchgeführt
- [ ] Freigabekriterien durch Product Owner bestätigt

Aktuelle automatisierte Abdeckung: 74 %.  
Zielwert: 85 %.  
Offene Defekte: 2 hoch, 5 mittel, 3 niedrig.

## 7. Freigaberegel

Eine Pilotfreigabe ist nur zulässig, wenn keine offenen kritischen Defekte existieren, alle hohen
Defekte eine dokumentierte Risikoakzeptanz besitzen und FR-02 sowie FR-03 durch automatisierte
Integrationstests nachgewiesen sind.

## 8. Offene Entscheidung

Die fachliche Entscheidung, ob ein Ausfall des E-Mail-Versands den Checkout fehlschlagen lassen
darf, ist noch nicht getroffen. Für die QA-Prüfung gilt vorläufig: Die Bestellung bleibt erfolgreich,
der Versand wird asynchron erneut versucht und ein Alarm wird ausgelöst.
