/**
 * Semantic relations: verbal analogies, relation matching and precise word
 * choice with graded vocabulary. Knowledge-loaded (Gc). Near-synonyms and
 * look-alike words are deliberate distractors; each item has one defensible key.
 */
import { bankParadigm } from '../paradigm';
import { bankItem, type BankContent, type BankItem } from './content';

export const semanticItems: BankItem[] = [
  /* ---------------------------------------------------------------- practice */
  bankItem({
    slug: 'practice-up-down',
    facet: 'analogy',
    b: -2,
    practice: true,
    question: 'up : down :: early : ?',
    options: ['late', 'soon', 'first', 'morning', 'quick'],
    key: 0,
    rationale: 'Up and down are opposites; the opposite of early is late.',
  }),
  bankItem({
    slug: 'practice-bisect',
    facet: 'precision',
    b: -2,
    practice: true,
    question: 'Which word means ‘to cut into two equal parts’?',
    options: ['dissect', 'bisect', 'intersect', 'section', 'segment'],
    key: 1,
    rationale: 'To bisect is to cut into two equal parts. To dissect is to cut apart in order to examine.',
  }),

  /* ----------------------------------------------------------------- analogy */
  bankItem({
    slug: 'hot-cold-tall',
    facet: 'analogy',
    b: -1.4,
    question: 'hot : cold :: tall : ?',
    options: ['high', 'long', 'short', 'wide', 'large'],
    key: 2,
    rationale: 'Hot and cold are opposites on one scale; the opposite of tall is short. High is close in meaning to tall, not opposite.',
  }),
  bankItem({
    slug: 'glove-hand-sock',
    facet: 'analogy',
    b: -0.9,
    question: 'glove : hand :: sock : ?',
    options: ['foot', 'shoe', 'knee', 'wool', 'boot'],
    key: 0,
    rationale: 'A glove is worn on the hand; a sock is worn on the foot. A shoe is worn over the sock, not by it.',
  }),
  bankItem({
    slug: 'author-composer',
    facet: 'analogy',
    b: -0.3,
    question: 'author : novel :: composer : ?',
    options: ['orchestra', 'piano', 'conductor', 'audience', 'symphony'],
    key: 4,
    rationale: 'An author creates a novel; a composer creates a symphony. An orchestra performs the work rather than being created by the composer.',
  }),
  bankItem({
    slug: 'petal-page',
    facet: 'analogy',
    b: 0.3,
    question: 'petal : flower :: page : ?',
    options: ['paper', 'book', 'word', 'library', 'ink'],
    key: 1,
    rationale: 'A petal is a part of a flower; a page is a part of a book. A library is a collection of books, which is a different relation.',
  }),
  bankItem({
    slug: 'wolf-lion',
    facet: 'analogy',
    b: 0.8,
    question: 'wolf : pack :: lion : ?',
    options: ['den', 'mane', 'savanna', 'pride', 'roar'],
    key: 3,
    rationale: 'A group of wolves is a pack; a group of lions is a pride. A den is a home, not a group.',
  }),
  bankItem({
    slug: 'thermometer-odometer',
    facet: 'analogy',
    b: 1.0,
    question: 'thermometer : temperature :: odometer : ?',
    options: ['speed', 'fuel', 'distance', 'time', 'pressure'],
    key: 2,
    rationale: 'A thermometer measures temperature; an odometer measures distance travelled. Speed is measured by a speedometer.',
  }),
  bankItem({
    slug: 'frugal-confident',
    facet: 'analogy',
    b: 1.4,
    question: 'frugal : miserly :: confident : ?',
    options: ['arrogant', 'timid', 'assured', 'determined', 'humble'],
    key: 0,
    rationale:
      'Miserly is frugality taken to an unpleasant excess; arrogant is confidence taken to an unpleasant excess. Assured is a near-synonym of confident, not an excess of it.',
  }),
  bankItem({
    slug: 'star-island',
    facet: 'analogy',
    b: 1.6,
    question: 'star : constellation :: island : ?',
    options: ['peninsula', 'archipelago', 'continent', 'isthmus', 'subcontinent'],
    key: 1,
    rationale:
      'A constellation is a group of stars; an archipelago is a group of islands. A peninsula and an isthmus are single landforms, not groups.',
  }),
  bankItem({
    slug: 'prologue-preamble',
    facet: 'analogy',
    b: 1.9,
    question: 'prologue : play :: preamble : ?',
    options: ['prelude', 'verdict', 'lawyer', 'overture', 'statute'],
    key: 4,
    rationale:
      'A prologue is the opening section of a play; a preamble is the opening section of a statute or constitution. Prelude and overture are themselves openings, not the works they open.',
  }),
  bankItem({
    slug: 'anhydrous-anaerobic',
    facet: 'analogy',
    b: 2.0,
    question: 'anhydrous : water :: anaerobic : ?',
    options: ['bacteria', 'oxygen', 'energy', 'sunlight', 'pressure'],
    key: 1,
    rationale:
      'Anhydrous means without water; anaerobic means without oxygen. Bacteria are often described as anaerobic, but they are not what the word says is absent.',
  }),
  bankItem({
    slug: 'hirsute-verdant',
    facet: 'analogy',
    b: 2.2,
    question: 'hirsute : hair :: verdant : ?',
    options: ['colour', 'water', 'greenery', 'daylight', 'soil'],
    key: 2,
    rationale: 'Hirsute means covered in hair; verdant means covered in green vegetation.',
  }),
  bankItem({
    slug: 'loquacious-prodigal',
    facet: 'analogy',
    b: 2.4,
    question: 'loquacious : taciturn :: prodigal : ?',
    options: ['profligate', 'repentant', 'philanthropic', 'parsimonious', 'extravagant'],
    key: 3,
    rationale:
      'Taciturn is the opposite of loquacious; parsimonious (very sparing with money) is the opposite of prodigal. Profligate and extravagant are near-synonyms of prodigal.',
  }),
  bankItem({
    slug: 'laconic-abstemious',
    facet: 'analogy',
    b: 2.5,
    question: 'laconic : words :: abstemious : ?',
    options: ['drink', 'money', 'sleep', 'praise', 'effort'],
    key: 0,
    rationale:
      'A laconic person is sparing with words; an abstemious person is sparing with food and drink. Being sparing with money is frugality, not abstemiousness.',
  }),
  bankItem({
    slug: 'ichthyology-oology',
    facet: 'analogy',
    b: 3.3,
    question: 'ichthyology : fish :: oology : ?',
    options: ['owls', 'bones', 'sounds', 'ears', 'eggs'],
    key: 4,
    rationale:
      'Ichthyology is the study of fish; oology is the study of birds’ eggs. The study of ears is otology, a look-alike word.',
  }),

  /* ---------------------------------------------------------------- relation */
  bankItem({
    slug: 'drought-famine',
    facet: 'relation',
    b: -1.0,
    question: 'Which pair shows the same relation as ‘drought : famine’?',
    options: ['rain : cloud', 'tree : leaf', 'sunrise : sunset', 'flood : damage', 'bread : wheat'],
    key: 3,
    rationale:
      'A drought causes famine, cause then effect; a flood causes damage in the same order. In ‘rain : cloud’ the order is reversed, since clouds produce rain.',
  }),
  bankItem({
    slug: 'find-opposites',
    facet: 'relation',
    b: -0.6,
    question: 'Which pair of words are opposites?',
    options: ['tranquil : peaceful', 'scarce : abundant', 'vast : huge', 'brief : short', 'calm : still'],
    key: 1,
    rationale: 'Scarce and abundant are opposites. Every other pair consists of near-synonyms.',
  }),
  bankItem({
    slug: 'warm-scalding',
    facet: 'relation',
    b: 0.6,
    question: 'Which pair shows the same relation as ‘warm : scalding’?',
    options: ['cool : freezing', 'hot : cold', 'damp : dry', 'boiling : hot', 'morning : evening'],
    key: 0,
    rationale:
      'Scalding is an extreme degree of warm, in that order; freezing is an extreme degree of cool. ‘boiling : hot’ has the same scale but the order reversed.',
  }),
  bankItem({
    slug: 'tree-forest',
    facet: 'relation',
    b: 0.9,
    question: 'Which pair shows the same relation as ‘tree : forest’?',
    options: ['branch : tree', 'chimney : building', 'roof : house', 'root : plant', 'soldier : army'],
    key: 4,
    rationale:
      'A tree is one member of a forest, a collection of similar things; a soldier is one member of an army. The other pairs are component parts of a single whole.',
  }),
  bankItem({
    slug: 'illegible-read',
    facet: 'relation',
    b: 1.3,
    question: 'Which pair shows the same relation as ‘illegible : read’?',
    options: ['visible : see', 'comprehensible : grasp', 'inaudible : hear', 'legible : write', 'audible : speak'],
    key: 2,
    rationale:
      'Something illegible cannot be read; something inaudible cannot be heard. ‘visible : see’ and ‘comprehensible : grasp’ express the opposite, what can be done.',
  }),
  bankItem({
    slug: 'stanza-poem',
    facet: 'relation',
    b: 1.6,
    question: 'Which pair shows the same relation as ‘stanza : poem’?',
    options: ['senator : senate', 'actor : cast', 'sheep : flock', 'chapter : novel', 'citizen : nation'],
    key: 3,
    rationale:
      'A stanza is a component section of a poem, as a chapter is of a novel. The other pairs are members of a group, a different part-to-whole relation.',
  }),
  bankItem({
    slug: 'impecunious-money',
    facet: 'relation',
    b: 1.8,
    question: 'Which pair shows the same relation as ‘impecunious : money’?',
    options: ['avaricious : money', 'ignorant : knowledge', 'erudite : learning', 'garrulous : speech', 'conscientious : diligence'],
    key: 1,
    rationale:
      'An impecunious person lacks money; an ignorant person lacks knowledge. An avaricious person craves money, and the remaining pairs describe having a great deal of something.',
  }),
  bankItem({
    slug: 'bibliophile-books',
    facet: 'relation',
    b: 2.3,
    question: 'Which pair shows the same relation as ‘bibliophile : books’?',
    options: ['oenophile : wine', 'misanthrope : people', 'sommelier : wine', 'cartographer : maps', 'xenophobe : strangers'],
    key: 0,
    rationale:
      'A bibliophile loves books; an oenophile loves wine. A sommelier serves wine professionally, and a misanthrope and a xenophobe dislike or fear their objects.',
  }),
  bankItem({
    slug: 'juror-jury',
    facet: 'relation',
    b: 2.4,
    question: 'Which pair shows the same relation as ‘juror : jury’?',
    options: ['verse : chapter', 'keel : hull', 'cardinal : conclave', 'windowpane : greenhouse', 'stamen : flower'],
    key: 2,
    rationale:
      'A juror is a member of a jury; a cardinal is a member of a conclave, the assembly of cardinals. The other pairs are physical or textual parts of a whole, not members of a body.',
  }),
  bankItem({
    slug: 'inscrutable-interpret',
    facet: 'relation',
    b: 2.7,
    question: 'Which pair shows the same relation as ‘inscrutable : interpret’?',
    options: ['palpable : touch', 'fragile : break', 'tractable : manage', 'recalcitrant : obey', 'elusive : catch'],
    key: 4,
    rationale:
      'Something inscrutable is hard for others to interpret; something elusive is hard for others to catch. A recalcitrant person is the one who refuses to obey, and the other pairs describe things that are easy to do.',
  }),

  /* --------------------------------------------------------------- precision */
  bankItem({
    slug: 'make-larger',
    facet: 'precision',
    b: -1.3,
    question: 'Which word means ‘to make something larger’?',
    options: ['shrink', 'enlarge', 'collect', 'repeat', 'lower'],
    key: 1,
    rationale: 'To enlarge is to make larger. To shrink is the opposite.',
  }),
  bankItem({
    slug: 'lacks-courage',
    facet: 'precision',
    b: -0.8,
    question: 'Which word describes someone who lacks courage or confidence in front of others?',
    options: ['rude', 'lazy', 'clumsy', 'careless', 'timid'],
    key: 4,
    rationale: 'Timid means lacking courage or confidence. The other words describe manners, effort or coordination.',
  }),
  bankItem({
    slug: 'once-a-year',
    facet: 'precision',
    b: 0.0,
    question: 'Which word means ‘happening once every year’?',
    options: ['biannual', 'centennial', 'annual', 'biennial', 'monthly'],
    key: 2,
    rationale: 'Annual means once a year. Biannual means twice a year and biennial every two years.',
  }),
  bankItem({
    slug: 'very-short-time',
    facet: 'precision',
    b: 0.5,
    question: 'Which word means ‘lasting for only a very short time’?',
    options: ['ephemeral', 'eternal', 'periodic', 'sporadic', 'intermittent'],
    key: 0,
    rationale: 'Ephemeral means short-lived. Sporadic means occurring irregularly, which says nothing about duration.',
  }),
  bankItem({
    slug: 'more-words-than-needed',
    facet: 'precision',
    b: 0.8,
    question: 'Which word means ‘using more words than are needed’?',
    options: ['terse', 'verbose', 'verbal', 'eloquent', 'cryptic'],
    key: 1,
    rationale: 'Verbose means using more words than needed. Verbal means relating to words or speech, with no sense of excess.',
  }),
  bankItem({
    slug: 'less-severe',
    facet: 'precision',
    b: 1.3,
    question: 'Which word means ‘to make something less severe without removing it’?',
    options: ['eliminate', 'exacerbate', 'militate', 'mitigate', 'negate'],
    key: 3,
    rationale:
      'To mitigate is to make less severe. Militate (to be a powerful factor against something) is a look-alike, and to exacerbate is to make worse.',
  }),
  bankItem({
    slug: 'give-up-right',
    facet: 'precision',
    b: 1.4,
    question: 'Which word means ‘to give up a right or claim voluntarily’?',
    options: ['forfeit', 'revoke', 'confiscate', 'defer', 'waive'],
    key: 4,
    rationale:
      'To waive is to give up a right voluntarily. To forfeit is to lose a right as a penalty, which is not voluntary.',
  }),
  bankItem({
    slug: 'out-of-window',
    facet: 'precision',
    b: 2.0,
    question: 'Which word means ‘to throw someone or something out of a window’?',
    options: ['defenestrate', 'fenestrate', 'decimate', 'expatriate', 'excommunicate'],
    key: 0,
    rationale:
      'To defenestrate is to throw out of a window. Fenestrate is a look-alike that refers to having windows or openings, not to throwing anything.',
  }),
  bankItem({
    slug: 'long-words',
    facet: 'precision',
    b: 2.6,
    question: 'Which word describes a style ‘given to using long words’?',
    options: ['laconic', 'circumlocutory', 'sesquipedalian', 'pedantic', 'mellifluous'],
    key: 2,
    rationale:
      'Sesquipedalian means given to long words. Circumlocutory means using many words to talk around a point, which concerns roundabout phrasing rather than long words; pedantic means overly concerned with minor rules.',
  }),
  bankItem({
    slug: 'notices-the-hidden',
    facet: 'precision',
    b: 2.6,
    question: 'Which word describes someone ‘quick to notice and understand things that are not obvious’?',
    options: ['perspicuous', 'pertinacious', 'unpretentious', 'perspicacious', 'precocious'],
    key: 3,
    rationale:
      'Perspicacious means having keen insight. Perspicuous, its look-alike, means clearly expressed, and describes writing rather than a person’s insight.',
  }),
  bankItem({
    slug: 'little-known',
    facet: 'precision',
    b: 2.9,
    question: 'Which word means ‘little known and hard to understand; obscure’?',
    options: ['recumbent', 'recondite', 'redolent', 'reticent', 'recalcitrant'],
    key: 1,
    rationale:
      'Recondite means little known and abstruse. Reticent means reluctant to speak, and redolent means fragrant or suggestive of something.',
  }),
  bankItem({
    slug: 'what-it-is-not',
    facet: 'precision',
    b: 3.4,
    question: 'Which word describes speaking of something ‘only by saying what it is not’?',
    options: ['apocryphal', 'aphoristic', 'emphatic', 'antithetical', 'apophatic'],
    key: 4,
    rationale:
      'Apophatic describes knowledge or speech by negation, saying only what something is not. Apocryphal means of doubtful authenticity, and aphoristic means expressed in short pithy sayings.',
  }),
];

export const semantic = bankParadigm<BankContent>({
  id: 'semantic',
  version: 1,
  domain: 'language',
  group: 'core',
  load: 'knowledge',
  title: 'Semantic relations',
  subtitle: 'Find the word that fits the relation exactly.',
  construct: 'Vocabulary and sensitivity to precise relations between word meanings.',
  instructions: [
    '‘A : B :: C : ?’ means A is to B as C is to which word.',
    'Other items ask for the pair with the same relation, or the word that matches a definition exactly.',
    'Near-synonyms are there on purpose, so choose the single most precise answer.',
  ],
  minutes: 5,
  minRtMs: 2500,
  items: semanticItems,
  facetTargets: {
    analogy: 0.4,
    relation: 0.3,
    precision: 0.3,
  },
  defaultA: 1.4,
  defaultTimeLimitMs: 45_000,
});
