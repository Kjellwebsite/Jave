# Lull Website

Nachbau des Lull-Design-Prototyps (`Home.dc.html`, `Main.dc.html`) als produktionsreife Website:
**Next.js 16 (App Router) + TypeScript + Tailwind 4**, gedacht für Vercel. Die App ist in sich
geschlossen und nutzt keine `@jave/*`-Pakete; sie liegt nur im selben pnpm-Workspace.

## Loslegen

```bash
pnpm install          # im Repo-Root
pnpm dev:lull         # http://localhost:3100
```

Prüfen wie in der CI: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.
Nur diese App: `pnpm --filter @lull/web build` bzw. `pnpm vitest run --project lull`.

## Aufbau

| Pfad                                     | Inhalt                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `data/products.json`                     | Alle Produktdaten aus dem Prototyp. Wird beim Import validiert (`lib/products.ts`).         |
| `lib/tablet.ts`, `components/Tablet.tsx` | Die CSS-3D-Tablette: gestapelte Scheiben mit `translateZ`, Algorithmus aus `buildLayers`.   |
| `app/page.tsx`, `components/home/*`      | Startseite: Hero, Laufband, Zahlen, Finder, Sortiment, Schichten, Zertifikat, Versand, FAQ. |
| `app/produkte/layout.tsx`                | Produktseite. Das Layout bleibt beim Wechsel zwischen `/produkte/[slug]` gemountet.         |
| `components/cart/*`, `lib/cart.ts`       | Warenkorb (localStorage) als Seitenleiste.                                                  |
| `app/api/checkout`, `lib/checkout.ts`    | Stripe Checkout, nur Testmodus.                                                             |
| `lib/content.ts`                         | Texte der Startseite aus dem Prototyp.                                                      |
| `lib/launch.ts`                          | Alles, was vor dem Launch noch fehlt (siehe unten).                                         |

**Produktwechsel.** Jede Tablette hat eine eigene Route (`/produkte/calm` … `/produkte/tide`),
die Glasleiste verlinkt sie. Weil die Seite im gemeinsamen Layout lebt, bleibt sie beim Wechsel
stehen und animiert wie im Prototyp: Hintergrund-Crossfade, die Tablette löst sich in Unschärfe
auf und kommt in neuer Farbe wieder (Farbwechsel nach 450 ms), die Preis-Ziffern rollen.

**Responsive.** Ab 1024 px folgt das Layout dem Prototyp (skaliert über die Einheit `--u`,
1 px bei 1440 px Breite). Darunter wird gestapelt: drei statt fünf Hero-Tabletten, Produktleiste
horizontal, Schichten-Legende unter der Tablette. Auf Phones rendert jede Tablette nur jede
zweite Scheibe (GPU-Speicher). Parallax nur mit Maus, `prefers-reduced-motion` stoppt alle
Animationen. Ohne JavaScript bleiben alle Inhalte sichtbar.

## Deploy auf Vercel

1. Vercel → _Add New Project_ → dieses Repository importieren.
2. **Root Directory: `apps/lull`**. Framework wird als Next.js erkannt, pnpm aus dem Lockfile.
3. Umgebungsvariablen setzen (alle optional):

| Variable               | Zweck                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`    | `sk_test_…` aktiviert den Checkout. Live-Keys werden abgelehnt, solange Testmodus. |
| `LULL_PLACEHOLDERS`    | `show` oder `hide`. Ohne Angabe: Platzhalter in Preview, nicht in Production.      |
| `NEXT_PUBLIC_SITE_URL` | Kanonische Domain für Metadaten. Sonst die Production-Domain von Vercel.           |

Jeder Push erzeugt ein Preview-Deployment. Checkout testen mit Karte `4242 4242 4242 4242`,
beliebigem Datum in der Zukunft und beliebiger Prüfnummer.

## Platzhalter: Preview ja, Production nein

Der Prototyp enthält erfundene Bewertungen. Fake-Bewertungen sind in der EU abmahnfähig. Darum
gilt (`lib/launch.ts`): lokal und auf Vercel-Previews wird das Design komplett gezeigt, auf der
Production-Domain fallen weg

- Sterne und „4,7 aus über 4.900 Bewertungen“ im Hero,
- Sterne auf den Sortiment-Karten,
- der Bewertungsabschnitt der Produktseiten (inklusive „Verifizierter Kauf“),
- der Link „Prüfbericht der aktuellen Charge ansehen“ (solange `CERTIFICATE_REPORT_URL` fehlt),
- der Button „Frag uns direkt“ (solange `CONTACT_URL` fehlt).

Die strukturierten Produktdaten (JSON-LD) enthalten bewusst keine Bewertungen.

**Geschmack, Wirkweise, Hinweise.** Optionale Felder in `data/products.json` schalten weitere
Abschnitte der Produktseite frei, aktuell bei Calm und Drift:

- `flavor` (Name, Beschreibung, drei Farben, `scene`): Chip im Hero und ein Band unter der
  Beschreibung, entweder Wolken („Raspberry Clouds“ bei Calm, `FlavorClouds.tsx`) oder ein
  Nachthimmel mit Mond und Heidelbeeren („Blueberry Moon“ bei Drift, `scene: "moon"`,
  `FlavorMoon.tsx`).
- `explainer` (Texte): „Anti-Überreizung“ mit der Grafik angespannt/ruhiger
  (`ArousalGraphic.tsx`). Schematisch, ohne Messwerte. Mit reduzierter Bewegung bleibt sie
  statisch und umschaltbar, ohne JavaScript zeigt sie den angespannten Zustand.
- `warnings`: produktspezifische Warnhinweise. Sie stehen in „Gut zu wissen“ zusammen mit der
  Verzehrempfehlung und den Pflichthinweisen nach § 4 NemV (`SUPPLEMENT_NOTICES` in
  `lib/content.ts`), die auf jeder Produktseite erscheinen.
- `release` plus `layer`, `roles` und `evidence` an den Wirkstoffen: die „Double Release
  Matrix“ bei Drift (`ReleaseMatrix.tsx`). Explodierte Tablette mit den drei Schichten, eine
  Nacht mit Schlafphasen und Freisetzung (`NightChart.tsx`, Fadenkreuz per Maus und Pfeiltasten,
  Tabellenansicht), je Phase eine Grafik (`SleepCharts.tsx`), die Wirkstoffmatrix und die Studien
  mit Links. Die Schlafdaten sind schematisch (`lib/sleep.ts`: typische Nacht innerhalb der
  Lehrbuch-Richtwerte, Zielprofil der Freisetzung, Melatonin-Modell mit 45 Minuten
  Halbwertszeit) und getestet. Die Diagrammfarben sind auf Farbenblindheit und Kontrast geprüft
  (`chartTokens.ts`).

Eine neue Rezeptur ist damit nur eine Änderung an `data/products.json`. Der Parser verlangt
weiterhin genau vier Wirkstoffe pro Produkt, weil Layout und Schichtgrafik dafür gebaut sind.

## Vor dem Launch offen

Aus dem Handoff, nicht selbst erfunden:

- **Bewertungen:** echte Bewertungen anbinden oder den Abschnitt ausgeblendet lassen.
- **AM-Zertifikat:** vergebende Stelle, Prüfumfang und Link zum Prüfbericht fehlen
  (`CERTIFICATE_REPORT_URL` in `lib/launch.ts`). Der Satz „keine versteckten Risiken“ aus dem
  Prototyp ist als absolutes Sicherheitsversprechen gestrichen.
- **Fachlich bestätigen:** Wirkstoffe, Dosierungen, Preise, Versandzeiten und Versandländer
  (Checkout aktuell nur Deutschland, `SHIPPING_COUNTRIES` in `lib/checkout.ts`).
- **Pflichtangaben:** Impressum, Datenschutz, AGB, Widerruf existieren als Platzhalter
  (`noindex`), der Text muss vom Betreiber kommen. Verzehrempfehlung, Pflichthinweise nach
  § 4 NemV und Warnhinweise stehen auf jeder Produktseite. Die Warnhinweise (Calm: Alkohol und
  dämpfende Substanzen, Schwangerschaft, Medikamente; Spark: Koffein nach LMIV Anhang III) sind
  Vorschläge und müssen fachlich bestätigt werden.
- **Kontakt:** Ziel für „Frag uns direkt“ (`CONTACT_URL` in `lib/launch.ts`).

Beim Bauen zusätzlich aufgefallen:

- **Streichpreise:** Ein durchgestrichener Altpreis ist nach § 11 PAngV nur mit dem niedrigsten
  Preis der letzten 30 Tage zulässig. Außerdem fehlen „inkl. MwSt.“ und der Versandkostenhinweis
  an den Preisen.
- **Wirkaussagen:** Formulierungen wie „verkürzt die Einschlaflatenz“ oder „dämpft die
  HPA-Achse“ sind gesundheitsbezogene Angaben. Für Nahrungsergänzungsmittel sind nur zugelassene
  Health Claims erlaubt (VO (EG) 1924/2006), also vor Launch rechtlich prüfen lassen. Das gilt
  auch für den Abschnitt „Anti-Überreizung“ und seine Grafik („Mit Calm: weniger Signale, mehr
  Hemmung“) und für die Double Release Matrix von Drift. Dort sind nur die als
  „EU-Health-Claim“ markierten Sätze zugelassene Angaben (Melatonin 1 mg, Magnesium). Die
  Studien wurden mit einzelnen Wirkstoffen gemacht, nicht mit Drift; die Magnolien-Daten stammen
  aus einer Tierstudie.
- **Drift-Rezeptur:** Melatonin 1 mg, L-Theanin 200 mg, Magnolienrinde 200 mg (Honokiol),
  Magnesium 100 mg. Melatonin stufen BfArM und BfR in Deutschland dosisunabhängig als
  Arzneimittel ein, die Rechtslage ist umstritten: vor Launch klären, sonst ohne Melatonin.
  Für Magnolienrinde Novel-Food-Status und Einstufung prüfen, Extrakt und Dosis fachlich
  festlegen. Freisetzungsprofil und Schichtaufbau sind Zielwerte, mit Dissolution-Tests belegen.
  „Blueberry Moon“ ist der Geschmack der Hülle, weil die Tablette unzerkaut geschluckt wird.
- **Geschmack:** „Raspberry Clouds“ passt zu einer Kau- oder Lutschtablette, die
  Verzehrempfehlung von Calm sagt aber „mit Wasser“. Darreichungsform klären.
- **Wirkstoffe:** Nur Stoffe, die in Nahrungsergänzungsmitteln zulässig sind. Arzneistoffe,
  nicht zugelassene Novel Foods und Research Chemicals gehören nicht in den Shop. Deshalb fehlen
  GB-115, DHH-B und 8β-(4′-Hydroxytigloyloxy)costunolid, ebenso Venetron (Apocynum-venetum-
  Extrakt, keine EU-Zulassung gefunden).
- **Kontrast:** Bei Drift steht der Blister-Text im Prototyp auf mittlerem Violett
  (Kontrast etwa 2:1). Das Design ist so übernommen und sollte geprüft werden.

## Checkout

`POST /api/checkout` mit `{ lines: [{ slug, qty }] }`. Der Server prüft den Warenkorb gegen den
Katalog (Preise kommen nie vom Client), legt eine Stripe-Checkout-Session an und schickt die
Kundschaft danach auf `/bestellung`. Ohne Schlüssel antwortet die Route mit 503 und der Warenkorb
zeigt „Der Checkout ist noch nicht aktiv“. Für echte Bestellungen fehlen noch: Live-Schlüssel,
Versandkosten, Steuern und ein Webhook (`checkout.session.completed`) für die Abwicklung.
