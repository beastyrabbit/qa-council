# Provider und Modelle

> Seit 0.3.0 werden nur Council-Modelle angeboten, deren Metadaten Tool-Support ausweisen:
> OpenRouter benötigt `tools` in `supported_parameters`, Ollama/AI Box `tools` in
> `/api/show`, Codex Custom-Tool-Support. Vor der ersten Verwendung läuft zusätzlich ein echter
> Submit-Probe; das Ergebnis wird 24 Stunden je Provider, Modell, Endpoint und Schema-Version
> gecached. Supervisor-Stufen erhalten ausschließlich ihr Submit-Tool, nie allgemeine
> Agentenwerkzeuge. Der Inference-Timeout beträgt standardmäßig 15 Minuten.

Die Provider-Einstellungen befinden sich in der Weboberfläche unter **Einstellungen**. Für jeden Provider kann die Modellliste über das Suchfeld direkt oberhalb des Dropdowns nach Name oder ID gefiltert und ein Standardmodell gespeichert werden. Dieselbe durchsuchbare Auswahl steht für jeden Anbieter im Testmodus separat bereit.

## Serverseitiges Codex

Interner Providername im Pi SDK: `openai-codex`.

- Authentifizierung über die eingebaute Pi-OAuth-Implementierung
- Zugang wird unter `${DATA_DIR}/pi/auth.json` gespeichert
- die Datei liegt im Kubernetes-Betrieb auf dem persistenten Volume
- lokal wird bei nicht gesetztem `DATA_DIR` ein vorhandenes `~/.pi/agent/auth.json` verwendet, wenn der projektlokale Auth-Speicher noch leer ist
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

Beispieladresse; ohne konfigurierte URL bleibt die AI Box deaktiviert:

```text
http://192.168.10.120:11434
```

Verwendete Schnittstellen:

- `GET /api/tags` für die Modellliste
- `POST /api/show` für Fähigkeiten, maximales Kontextfenster und ein im Modelfile gesetztes `num_ctx`
- `POST /api/embed` für die lokale Dokument-Retrieval-Voranalyse
- `/v1` als OpenAI-kompatible Inferenzbasis

Das Standardmodell bei einer neuen Datenbank ist `qwen3-coder-next:q4km`. Die Einstellungsseite zeigt nur Modelle mit der Ollama-Fähigkeit `completion`; reine Embedding-Modelle sind für Council-Läufe nicht auswählbar. Deshalb kann die Zahl in der Council-Auswahl kleiner sein als die Zahl aus `ollama list`. Neben jedem Modell steht das verwendbare Kontextfenster. Ein `PARAMETER num_ctx` im Modelfile oder der aktuelle `context_length` aus `/api/ps` begrenzt den effektiven Wert; die Auswahl stellt ihn dem theoretischen Modellmaximum gegenüber.

Die lokale Voranalyse großer Dokumente besitzt eine getrennte Modellauswahl. Dort erscheinen nur
Modelle, deren `/api/show`-Metadaten die Capability `embedding` und die kompatible Größe von 4.096
Dimensionen enthalten. Standard ist `qwen3-embedding:8b`. Dokumentchunks, kleinere Passagen und
die kanonischen RACI-Zeilen werden anhand ihrer Inhalts- und Schema-Hashes nur einmal eingebettet; der
`sqlite-vec`-Index wird danach dokumentübergreifend wiederverwendet. Der Index ist ableitbar und
ersetzt weder Originaltext noch persistente Review-Artefakte.

Schlägt die lokale Embedding-Inferenz fehl, wird kein externer Provider als Ersatz aufgerufen.
Der Council-Lauf arbeitet mit der exakten und strukturellen Retrieval-Analyse weiter und schreibt
eine Warnung ins Laufprotokoll.

Die OpenAI-kompatible Ollama-API kann `num_ctx` nicht pro Request ändern. Ein größeres Kontextfenster muss daher auf der AI Box über `OLLAMA_CONTEXT_LENGTH` oder einen eigenen Modellalias mit `PARAMETER num_ctx` konfiguriert werden. `GET /api/ps` zeigt das tatsächlich geladene Kontextfenster.

Ist die AI Box nicht erreichbar, bleibt das gespeicherte Modell auswählbar und wird als nicht erreichbar gekennzeichnet.

Für lokale Ollama-Inferenz wird kein echter API-Key benötigt. Intern verwendet die Pi-Konfiguration einen nicht geheimen Platzhalter, weil die OpenAI-kompatible Schnittstelle ein Key-Feld erwartet.

## Bildquellen nach Textprovider

Der Report-Designer erzeugt pro Lauf ein dokumentbezogenes englisches Bildbriefing. Die tatsächliche
Bildquelle wird automatisch nach dem Textprovider gewählt:

- **Codex:** native OpenAI-Bild-API mit `gpt-image-2`. Der Codex-OAuth-Zugang bleibt für Text;
  die Bild-API benötigt zusätzlich `OPENAI_API_KEY` oder den verschlüsselt in den Einstellungen
  gespeicherten OpenAI-API-Key. Es gibt für Codex keinen ComfyUI-Fallback.
- **OpenRouter:** Wenn das ausgewählte Modell auch im Pi-Bildmodellkatalog Text-zu-Bild-Ausgabe
  unterstützt, wird genau dieses Modell nativ verwendet. Bei einem reinen Textmodell oder einem
  Fehler darf ComfyUI übernehmen.
- **AI Box:** ComfyUI ist die optionale lokale Bildquelle. Der Schalter gilt auch dann, wenn
  **HTML / Nur Text** als Startansicht gewählt ist, weil Tageszeitung und Visual Report trotzdem im selben
  Lauf entstehen.

Beispieladresse; ohne konfigurierte URL bleibt ComfyUI deaktiviert:

```text
http://192.168.10.120:8188
```

Die Oberfläche prüft `GET /system_stats` und liest die Checkpoints über `GET /models/checkpoints`. Für die Generierung wird ein Workflow an `POST /prompt` übergeben, der Abschluss über `/history/<prompt-id>` verfolgt und das Ergebnis über `/view` geladen. Das lokale Anima-Preset verwendet zusätzlich `qwen_3_06b_base.safetensors` und `qwen_image_vae.safetensors`.

Das Bild und der verwendete Prompt werden in SQLite dem Lauf zugeordnet. Jeder neue Lauf erzeugt
ein neues Motiv; Tageszeitung, Visual Report und PDF desselben Laufs verwenden anschließend dieselbe
gespeicherte Datei. Ist die gewählte Bildquelle nicht erreichbar oder fehlt ein Zugang, wird der
fachliche Lauf nicht verworfen: Die Darstellung wird ohne Bild fertiggestellt und die Ursache
erscheint als Warnung im Live-Systemprotokoll.

## Session-Konfiguration

Alle drei Provider werden identisch abgesichert:

- keine Agentenwerkzeuge
- In-Memory-Session
- keine Projektdatei- oder Skill-Autodiscovery
- expliziter, hash-geprüfter Systemprompt
- automatische Pi-Kontextkompaktierung mit 8.192 reservierten und 20.000 zuletzt erhaltenen Tokens
- begrenzte automatische Retries
- ein zusätzlicher Versuch bei einer leeren AI-Box-Antwort
- Text- und Thinking-Deltas werden für die Live-Laufansicht getrennt gespeichert; Thinking bleibt standardmäßig eingeklappt
- die Report-Design-Stufe lädt ausschließlich den eigenen hash-geprüften `report-designer`-Skill und streamt ihr direkt erzeugtes HTML sichtbar in das Laufprotokoll

Jede Council-Stufe verwendet eine neue Pi-Session mit einem Benutzerturn. Kompaktierung schützt damit vor wachsenden Mehrturn- oder Retry-Verläufen, kann aber einen bereits zu großen ersten System- und Benutzerprompt nicht verkleinern. Die Chairman-Stufen erhalten deshalb die Council-/RACI-Regeln und fertigen Rollenreviews, nicht erneut alle vollständigen Rollenhandbücher.

Für dynamisch registrierte AI-Box-Modelle wird die mögliche Ausgabe abhängig vom tatsächlich geladenen Kontextfenster bis maximal 16.384 Tokens freigegeben. Damit kann der Report-Designer Tageszeitung und Visual Report in einem Package erzeugen, ohne künstlich auf 4.096 Ausgabetokens begrenzt zu sein.

Reasoning wird bei allen Modellen, die es ausweisen, automatisch auf `high` gesetzt. Für lokale
Ollama-Modelle wird dafür die `thinking`-Capability aus `/api/show` verwendet. OpenRouter kann in
den Einstellungen zwischen Standard-Load-Balancing, niedrigstem Preis und höchstem Durchsatz
geroutet werden; der Modellpicker zeigt Eingabe- und Ausgabepreis pro Million Token.

## Providerwahl pro Lauf

Ein Lauf speichert Provider und Modell unveränderlich. Eine spätere Änderung der Einstellungen ändert bestehende Läufe nicht. Zusätzliche Präsentationen verwenden den Provider und das Modell des ursprünglichen Laufs, damit Herkunft und Kosten nachvollziehbar bleiben.

Im Testmodus werden die ausgewählten Modelle vor dem Start nochmals gegen die aktuelle
Provider-Modellliste geprüft. Nur konfigurierte und dort verfügbare Kombinationen werden
eingereiht. Ein Fehler beim anschließenden echten Modellstream bleibt als fehlgeschlagener
Vergleichslauf sichtbar; er wird nicht still entfernt oder durch einen anderen Anbieter ersetzt.
