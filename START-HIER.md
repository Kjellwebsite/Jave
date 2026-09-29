# JAVE starten · die einfachste Anleitung

Du brauchst etwa 20 Minuten, einmal. Danach reicht ein einziger Befehl.

## 1. Zwei Programme installieren

- **Node.js** (LTS-Version): https://nodejs.org
- **Docker Desktop**: https://www.docker.com/products/docker-desktop – danach **öffnen** und
  laufen lassen.

## 2. JAVE herunterladen

Auf GitHub: grüner Knopf **Code** → **Download ZIP** → entpacken.

## 3. Deinen Bot bei Discord anlegen

1. Öffne https://discord.com/developers/applications → **New Application** → Name z. B. „JAVELIN“.
2. Links auf **Bot** → **Reset Token** → **Copy**. Diesen Token gleich einfügen. Er ist geheim wie
   ein Passwort.
3. Ebenfalls unter **Bot** einschalten: **Server Members Intent** und **Message Content Intent**.
   Speichern.
4. In Discord: **Einstellungen → Erweitert → Entwicklermodus** einschalten. Damit kannst du
   IDs kopieren (Rechtsklick → „ID kopieren“).

## 4. Starten

Öffne im entpackten Ordner ein Terminal:

- **Windows:** Rechtsklick in den Ordner → „Im Terminal öffnen“
- **Mac:** Terminal öffnen, `cd ` tippen (mit Leerzeichen), den Ordner hineinziehen, Enter

Dann eintippen:

```
node start.mjs
```

Beim ersten Mal fragt JAVE nach vier Dingen und sagt dir jeweils, wo du sie findest:

| Frage           | Wo                                                                     |
| --------------- | ---------------------------------------------------------------------- |
| Application ID  | Developer Portal → General Information                                 |
| Bot-Token       | den aus Schritt 3                                                      |
| Server-ID       | Rechtsklick auf deinen Server → „Server-ID kopieren“                   |
| Deine Nutzer-ID | Rechtsklick auf deinen Namen → „Nutzer-ID kopieren“ (du wirst Founder) |

Danach zeigt JAVE einen **Einladungslink**. Öffnen, deinen Server wählen, bestätigen. Dann in den
**Server-Einstellungen → Rollen** die Rolle des Bots **ganz nach oben** ziehen und im Terminal Enter
drücken.

JAVE erledigt den Rest: Datenbank, Befehle, Bot und Dashboard.

## 5. Fertig

- In Discord: **`/jave setup`** zeigt, ob alles stimmt (✓ oder was fehlt).
- **`/start`** legt dein Profil an, **`/help`** zeigt alle Befehle.
- Dashboard im Browser: http://localhost:3000

**Beenden:** im Terminal `Strg + C`. **Nächstes Mal:** wieder `node start.mjs`, ohne Fragen.

## Wenn etwas nicht klappt

JAVE sagt dir im Terminal, was fehlt, zum Beispiel „Docker läuft nicht“ oder „Der Bot ist noch
nicht in deinem Server“ mit dem Link dazu. Einen falschen Wert änderst du in der Datei `.env` im
Ordner (mit dem Editor öffnen) und startest dann neu.

Der Bot läuft, solange dein Computer an ist. Für einen Server, der rund um die Uhr läuft, siehe
[DEPLOYMENT.md](DEPLOYMENT.md).
