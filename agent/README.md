# JAVE Agent · lokaler KI-Agent

Ein schneller KI-Agent, der **komplett auf deinem Computer** läuft, mit
[Gemma 4 12B uncensored](https://huggingface.co/TrevorJS/gemma-4-12B-it-uncensored-GGUF)
(GGUF, Apache 2.0). Kein Konto, keine API-Kosten. Nichts verlässt deinen Rechner, außer
den Webseiten, die der Agent selbst abruft.

Der Agent hat **echten Zugriff** auf deinen Computer:

| Werkzeug         | Was es tut                                               | Fragt vorher? |
| ---------------- | -------------------------------------------------------- | :-----------: |
| `list_directory` | Ordnerinhalt anzeigen                                    |     nein      |
| `find_files`     | Dateien nach Namen finden (`**/*.pdf`)                   |     nein      |
| `search_files`   | In Dateien suchen (wie grep)                             |     nein      |
| `read_file`      | Dateien lesen                                            |     nein      |
| `write_file`     | Dateien anlegen oder überschreiben                       |    **ja**     |
| `edit_file`      | Stellen in Dateien ändern (zeigt dir die Änderung)       |    **ja**     |
| `run_command`    | Befehle ausführen (PowerShell unter Windows, sonst bash) |    **ja**     |
| `fetch_url`      | Webseiten und Dateien aus dem Internet lesen             |     nein      |
| `web_search`     | Im Web suchen (DuckDuckGo)                               |     nein      |

Vor jeder Änderung fragt der Agent: **[j]** ja, **[n]** nein oder **[i]** immer (für
diese Sitzung). Mit `--auto` fragt er gar nicht mehr. Dann kann er alles, was dein
Benutzerkonto kann. Das Modell ist „uncensored“, es lehnt also kaum etwas ab. Nutze
`--auto` deshalb nur, wenn du weißt, was du ihm aufträgst.

## Starten

Du brauchst Node.js 22.12 oder neuer. Wenn JAVE installiert ist ([START-HIER.md](../START-HIER.md)),
ist es schon da.

- **Windows:** Doppelklick auf `agent\starten.cmd` (im JAVE-Ordner: `%USERPROFILE%\JAVE\app\agent`)
- **Mac:** Doppelklick auf `agent/starten.command`
- **Terminal, im JAVE-Ordner:** `node agent/agent.mjs` (oder `pnpm agent`)

Beim **ersten Start** lädt der Agent zwei Dinge in den Ordner `~/.jave-agent`:

1. **llama.cpp** (der Modell-Server, ~50–400 MB). Er nimmt automatisch die passende Version:
   NVIDIA CUDA, Vulkan (AMD/Intel/NVIDIA), Apple Metal oder CPU.
2. **Das Modell** `gemma-4-12B-it-uncensored-Q4_K_M.gguf` (7,4 GB). Bricht der Download ab,
   geht er beim nächsten Start an derselben Stelle weiter.

Danach startet er in wenigen Sekunden:

```
JAVE Agent · gemma-4-12b · lokal
  Ordner: C:\Users\du
  Vor Änderungen und Befehlen wird gefragt · /hilfe für Befehle

› Welche PDFs in Downloads sind größer als 10 MB? Verschieb sie nach Downloads\gross
⚙ run_command Get-ChildItem $HOME\Downloads -Filter *.pdf | Where-Object Length -gt 10MB …

  ? Befehl ausführen (PowerShell, in C:\Users\du):
    Get-ChildItem $HOME\Downloads -Filter *.pdf | …
  [j] ja  [n] nein  [i] immer (für diese Sitzung) › j
```

Eine einzelne Aufgabe ohne Chat: `node agent/agent.mjs "Fasse README.md in 5 Punkten zusammen"`

## Im Agenten

| Eingabe          | Wirkung                                          |
| ---------------- | ------------------------------------------------ |
| `/neu`           | Neue Unterhaltung (vergisst den Verlauf)         |
| `/auto`          | Rückfragen an/aus                                |
| `/denken`        | Denkmodus an/aus: gründlicher, aber langsamer    |
| `/ordner <pfad>` | Arbeitsordner wechseln                           |
| `/exit`          | Beenden (auch `Strg+D` oder zweimal `Strg+C`)    |
| `Strg+C`         | Laufende Antwort oder laufenden Befehl abbrechen |

Liegt im Arbeitsordner eine `AGENTS.md`, liest der Agent sie als Projekthinweise.

## Optionen

```
node agent/agent.mjs --hilfe
  --auto                 nicht nachfragen
  --denken               Denkmodus an
  --ordner <pfad>        Arbeitsordner (Standard: aktueller Ordner; Doppelklick: dein Benutzerordner)
  --quant Q8_0           genaueres Modell (12,7 GB, braucht mehr Speicher)
  --modell <datei.gguf>  eine schon heruntergeladene GGUF-Datei nehmen
  --kontext <n>          Kontextlänge in Tokens (Standard 16384)
  --gpu-layers <n>       Schichten auf der Grafikkarte (Standard: automatisch)
  --port <n>             Port des Modell-Servers (Standard 8088)
  --server-behalten      Modell-Server beim Beenden weiterlaufen lassen (nächster Start sofort)
  --base-url <url>       einen laufenden OpenAI-kompatiblen Server nehmen (LM Studio, Ollama …)
```

## Wie schnell ist das?

Das hängt fast nur vom Speicher ab, in den das Modell passt:

| Computer                            | etwa           |
| ----------------------------------- | -------------- |
| NVIDIA-Grafikkarte mit ≥ 10 GB VRAM | 40–80 Tokens/s |
| Mac mit Apple Silicon und ≥ 16 GB   | 20–40 Tokens/s |
| Nur CPU, 16 GB RAM                  | 3–8 Tokens/s   |

Nach jeder Antwort steht die gemessene Geschwindigkeit. Tipps:

- **Denkmodus aus lassen** (Standard). Er kostet viele Tokens pro Antwort.
- **`--server-behalten`:** Das Modell bleibt geladen, der nächste Start dauert unter einer Sekunde.
- **Wenig Grafikspeicher (6–8 GB):** `--gpu-layers 30` oder `--kontext 8192`.
- Der Agent schickt den gleichbleibenden Anfang jeder Unterhaltung nicht neu durch das Modell
  (Prompt-Cache). Folgeschritte starten deshalb sofort.

## Das Modell auch für die JAVE-KI nutzen

Der Agent spricht die OpenAI-API. Die JAVE-KI im Bot und im Dashboard kann dasselbe lokale
Modell nehmen. Den Server allein starten:

```
node agent/agent.mjs server
```

und in `.env` eintragen:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://127.0.0.1:8088/v1
AI_MODEL=gemma-4-12b
```

Im Browser zeigt http://127.0.0.1:8088 außerdem die Chat-Oberfläche von llama.cpp.

## Mit LM Studio oder Ollama statt llama.cpp

Läuft das Modell schon woanders, lädt der Agent nichts herunter:

```
node agent/agent.mjs --base-url http://127.0.0.1:1234/v1    # LM Studio
node agent/agent.mjs --base-url http://127.0.0.1:11434/v1   # Ollama
```

Das Modell braucht llama.cpp ab dem 4. Juni 2026 (Gemma-4-Unified-Support). Ältere Runtimes
laden die Datei nicht. Der eingebaute Download nimmt immer die neueste Version.

## Wo liegt was?

Alles liegt in `~/.jave-agent`, unter Windows in `%USERPROFILE%\.jave-agent`. Mit
`JAVE_AGENT_HOME` kannst du einen anderen Ordner festlegen.

- `llama.cpp/`: der Modell-Server
- `models/`: die GGUF-Datei
- `server.log`: das Log des Modell-Servers (bei Problemen hier nachsehen)

**Entfernen:** den Ordner `.jave-agent` löschen.

## Wenn etwas nicht klappt

| Meldung                                  | Abhilfe                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| „llama.cpp ist zu alt für dieses Modell“ | `node agent/agent.mjs update`                                        |
| „Zu wenig Speicher“                      | `--kontext 8192`, `--gpu-layers 20`, oder andere Programme schließen |
| „Der Port ist belegt“                    | `--port 8099`                                                        |
| Sehr langsam trotz Grafikkarte           | Grafiktreiber aktualisieren, dann `node agent/agent.mjs update`      |
| Websuche liefert nichts                  | DuckDuckGo drosselt kurz. Kurz warten oder direkt eine URL nennen    |

Die Tests des Agenten laufen ohne Modell: `node --test "agent/test/*.test.mjs"`
