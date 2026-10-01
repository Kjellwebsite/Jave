# JAVE starten · die einfachste Anleitung

Zwei Teile, etwa 15 Minuten, nur einmal:

1. **Eine Zeile einfügen.** Sie installiert alles, was JAVE braucht: Node.js, JAVE selbst und eine
   eigene Datenbank. Du musst nichts extra herunterladen, auch kein Docker.
2. **Deinen Bot bei Discord anlegen.** Das geht nur mit deinem Discord-Konto, deshalb machst du
   das. JAVE öffnet dir die richtigen Seiten und sagt dir bei jedem Schritt, was zu tun ist.

## 1. Die Zeile einfügen

**Windows:** Start-Taste drücken, `PowerShell` tippen, öffnen. Diese Zeile kopieren, im blauen
Fenster mit **Rechtsklick** einfügen, **Enter**:

```
irm https://raw.githubusercontent.com/Kjellwebsite/Jave/HEAD/install.ps1 | iex
```

**Mac:** Programme → Dienstprogramme → **Terminal** öffnen. Diese Zeile einfügen (`⌘ + V`),
**Enter**:

```
curl -fsSL https://raw.githubusercontent.com/Kjellwebsite/Jave/HEAD/install.sh | bash
```

Beim ersten Mal lädt JAVE ein paar Minuten lang. Danach stellt es dir Fragen, siehe Teil 2.

> Fragt Windows, ob Node.js ins Netzwerk darf: „Zulassen“ oder „Abbrechen“, beides geht.

## 2. Deinen Bot bei Discord anlegen

JAVE öffnet das **Discord Developer Portal** im Browser (sonst: https://discord.com/developers/applications)
und fragt nacheinander nach diesen Werten. Jeweils kopieren und im Fenster mit **Rechtsklick**
bzw. `⌘ + V` einfügen, dann **Enter**.

1. **New Application** → Name, z. B. „JAVELIN“ → **Create**.
   Auf der Seite **General Information** die **Application ID** kopieren → einfügen.
2. Links auf **Bot** → **Reset Token** → **Copy** → einfügen.
   Der Token ist geheim wie ein Passwort: **niemandem schicken, in keinen Chat.**
3. Auf derselben Seite weiter unten **Server Members Intent** und **Message Content Intent**
   einschalten → **Save Changes**.
4. In Discord: **Einstellungen → Erweitert → Entwicklermodus** einschalten.
   Dann Rechtsklick auf deinen Server → **Server-ID kopieren** → einfügen.
5. Rechtsklick auf deinen eigenen Namen → **Nutzer-ID kopieren** → einfügen. Damit wirst du Founder.
6. Frage nach dem „Client Secret“: einfach **Enter** drücken.

Dann öffnet JAVE den **Einladungslink**: deinen Server wählen → **Autorisieren**. Danach in Discord
**Server-Einstellungen → Rollen** die Rolle des Bots **ganz nach oben** ziehen und im Fenster
**Enter** drücken.

JAVE erledigt den Rest: Datenbank, Befehle, Bot und Dashboard.

## 3. Fertig

- In Discord: **`/jave setup`** zeigt, ob alles stimmt (✓ oder was fehlt).
- **`/start`** legt dein Profil an, **`/help`** zeigt alle Befehle.
- Dashboard im Browser: http://localhost:3000

**Nächstes Mal** ohne Fragen:

- **Windows:** Doppelklick auf **„JAVE starten“** auf dem Desktop.
- **Mac:** Doppelklick auf **„JAVE“** auf dem Schreibtisch.

**Beenden:** `Strg + C` im Fenster, oder das Fenster schließen.
**Aktualisieren:** die Zeile aus Teil 1 noch einmal einfügen. Deine Einstellungen und Daten bleiben.

## Extra: der lokale KI-Agent

Im JAVE-Ordner liegt auch **JAVE Agent**, ein KI-Agent, der komplett auf deinem Computer läuft
(Gemma 4 12B, ohne Konto und ohne Kosten). Er kann Dateien lesen und bearbeiten, Befehle
ausführen und im Web suchen. Vor jeder Änderung fragt er dich.

- **Windows:** Doppelklick auf `starten.cmd` im Ordner `%USERPROFILE%\JAVE\app\agent`
- **Mac:** Doppelklick auf `starten.command` im Ordner `~/JAVE/app/agent`

Beim ersten Start lädt er etwa 8 GB herunter. Mehr dazu in [agent/README.md](agent/README.md).

## Wenn etwas nicht klappt

JAVE sagt dir im Fenster, was fehlt, zum Beispiel „Der Bot ist noch nicht in deinem Server“ mit
dem Link dazu, oder dass die zwei Schalter aus Schritt 2.3 fehlen. Das Problem beheben und JAVE
neu starten.

Einen falsch eingefügten Wert änderst du in der Datei `.env` (mit dem Editor öffnen):

- **Windows:** `C:\Users\<dein Name>\JAVE\app\.env`
- **Mac:** Finder → `⌘ + ⇧ + G` → `~/JAVE/app/.env`

Der Bot läuft, solange dein Computer an ist und das Fenster offen bleibt. Für einen Server, der rund
um die Uhr läuft, siehe [DEPLOYMENT.md](DEPLOYMENT.md).

<details>
<summary>Ohne die Zeile, von Hand</summary>

Node.js 22.12 oder neuer installieren (https://nodejs.org), dieses Repository herunterladen
(**Code → Download ZIP**, entpacken), im Ordner ein Terminal öffnen und `node start.mjs` eingeben.
Es stellt dieselben Fragen. Läuft schon PostgreSQL auf Port 5432 (z. B. mit
`docker compose up -d`), nimmt JAVE diese Datenbank, sonst seine eigene.

</details>
