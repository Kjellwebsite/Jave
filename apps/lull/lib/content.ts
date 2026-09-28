/**
 * Copy of the home page, taken from the prototype (`Home.dc.html`). Brand voice: human, direct,
 * no dashes as punctuation. Product copy lives in `data/products.json`.
 */

export const TABLETS_PER_BLISTER = 14;

export const HERO = {
  headline: 'Stimmung ist',
  accent: 'Biochemie.',
  lead: 'Fünf Formeln, jede um einen klaren Mechanismus gebaut. Dosiert nach Studienlage, in drei Schichten gepresst, einzeln im Blister versiegelt.',
} as const;

export const STAT_NOTES = {
  formulas: 'Eine für jeden Zustand, von Ruhe bis Regeneration.',
  ingredients: 'Jeder mit bekanntem Signalweg und Humandaten.',
  layers: 'Getrennt gepresst, gestaffelt freigesetzt.',
  tablets: 'Pro Blister, jede einzeln versiegelt.',
} as const;

export const BUILD_PRINCIPLES = [
  {
    title: 'Mechanismus zuerst',
    text: 'Jeder Wirkstoff steht für einen bekannten Signalweg. Nichts, was nur auf dem Etikett gut aussieht.',
  },
  {
    title: 'Dosis nach Studienlage',
    text: 'Wir dosieren in den Bereichen, die in Humanstudien untersucht wurden, statt Spuren fürs Marketing.',
  },
  {
    title: 'Drei Schichten',
    text: 'Wirkstoffe werden getrennt gepresst. So bleiben sie stabil, bis du sie brauchst, und werden gestaffelt frei.',
  },
] as const;

/** Labels of the exploded Calm tablet, top to bottom. */
export const LAYER_LABELS = [
  { title: 'Deckschicht', text: 'Löst sich zuerst, schneller Einstieg', color: '#f4b6d2' },
  { title: 'Wirkkern', text: 'Trägt die Hauptdosis', color: '#e0218a' },
  { title: 'Basisschicht', text: 'Gibt langsam ab, gleichmäßiger Verlauf', color: '#c4122f' },
] as const;

export const CERTIFICATE = {
  title: 'Das AM-Zertifikat',
  // The prototype opened with "Kein Rätselraten, keine versteckten Risiken." The handoff rules
  // out absolute safety promises, so the second half is dropped until the claim is verified.
  lead: 'Kein Rätselraten. Jede Charge geht ins unabhängige Labor, bevor sie zu dir kommt. Nur was alle Prüfungen besteht, bekommt das AM-Zertifikat und darf raus.',
  ring: 'JEDE CHARGE GEPRÜFT ✦ UNABHÄNGIGES LABOR ✦ AM ZERTIFIZIERT ✦ MADE IN GERMANY ✦',
  checks: [
    {
      title: 'Wirkstoffgehalt geprüft',
      text: 'Was auf dem Etikett steht, ist auch drin.',
      color: '#e0218a',
    },
    {
      title: 'Schwermetalle getestet',
      text: 'Blei, Cadmium, Quecksilber und Arsen unter Grenzwert.',
      color: '#8f7ae0',
    },
    {
      title: 'Mikrobiologisch sauber',
      text: 'Keime, Hefen und Schimmel werden ausgeschlossen.',
      color: '#4aa8ff',
    },
    {
      title: 'Made in Germany',
      text: 'Produziert, gepresst und verblistert in Deutschland.',
      color: '#3fd18f',
    },
  ],
  reportLabel: 'Prüfbericht der aktuellen Charge ansehen',
} as const;

export const SHIPPING = {
  badge: 'Versand direkt aus Deutschland',
  title: ['Ultraschnell.', 'Direkt als Brief.'],
  lead: 'Ein Blister ist flach genug für einen normalen Brief. Kein Paket, kein Abholschein, keine Packstation. Bis 14 Uhr bestellt, geht er noch am selben Tag raus.',
  steps: [
    { title: 'Bestellt', text: 'bis 14 Uhr' },
    { title: 'Verpackt', text: 'am selben Tag' },
    { title: 'Unterwegs', text: 'als flacher Brief' },
    { title: 'Im Briefkasten', text: 'in 1 bis 2 Werktagen' },
  ],
} as const;

export const FAQ = [
  {
    q: 'Wie schnell merke ich etwas?',
    a: 'Calm und Spark wirken akut, meist nach 30 bis 60 Minuten. Drift nimmst du vor dem Schlafen. Bloom und Tide sind für die regelmäßige Einnahme gebaut, hier merkst du den Effekt eher nach zwei bis drei Wochen.',
  },
  {
    q: 'Kann ich mehrere Lull Produkte kombinieren?',
    a: 'Ja, die Formeln sind aufeinander abgestimmt. Ein klassisches Setup ist Spark am Morgen und Drift am Abend. Calm und Spark enthalten beide L-Theanin, am selben Tag also nicht beide voll ausreizen.',
  },
  {
    q: 'Was genau prüft das AM-Zertifikat?',
    a: 'Jede Charge geht ins unabhängige Labor und wird auf Wirkstoffgehalt, Schwermetalle und Mikrobiologie getestet. Den Prüfbericht zu deiner Charge findest du über den Code auf dem Blister.',
  },
  {
    q: 'Wie schnell ist meine Bestellung da?',
    a: 'Bis 14 Uhr bestellt, geht dein Blister noch am selben Tag als Brief raus. Innerhalb Deutschlands liegt er meist nach 1 bis 2 Werktagen in deinem Briefkasten.',
  },
  {
    q: 'Muss ich zu Hause sein, wenn die Lieferung kommt?',
    a: 'Nein. Der Blister kommt als flacher Brief und passt in jeden normalen Briefkasten. Kein Paket, keine Packstation, kein Abholschein.',
  },
  {
    q: 'Kann ich Lull zusammen mit Medikamenten nehmen?',
    a: 'Wenn du regelmäßig Medikamente nimmst, schwanger bist oder stillst, sprich vorher mit deiner Ärztin oder deinem Arzt. Die vollständigen Inhaltsstoffe stehen auf jeder Produktseite.',
  },
  {
    q: 'Was, wenn es mir nicht passt?',
    a: 'Ungeöffnete Blister kannst du innerhalb von 30 Tagen zurückschicken. Einfach per Brief, genauso wie er gekommen ist.',
  },
] as const;

/**
 * Mandatory statements for food supplements in Germany (§ 4 Abs. 2 NemV), shown on every
 * product page next to the recommended daily intake (the product's `howto`).
 */
export const SUPPLEMENT_NOTICES = [
  'Die angegebene empfohlene tägliche Verzehrsmenge darf nicht überschritten werden.',
  'Nahrungsergänzungsmittel sind kein Ersatz für eine ausgewogene und abwechslungsreiche Ernährung und eine gesunde Lebensweise.',
  'Außerhalb der Reichweite von kleinen Kindern lagern.',
] as const;

export const DISCLAIMER =
  'Nahrungsergänzungsmittel. Kein Ersatz für eine ausgewogene Ernährung oder ärztliche Behandlung.';
