/**
 * Precise reading: short rules, policies and statements with quantifier,
 * scope and condition subtleties. Everything needed is in the text; the key
 * is what the text strictly permits, requires or implies.
 */
import { bankParadigm } from '../paradigm';
import { bankItem, type BankContent, type BankItem } from './content';

export const readingItems: BankItem[] = [
  /* ---------------------------------------------------------------- practice */
  bankItem({
    slug: 'practice-sign-in',
    facet: 'instructions',
    b: -2,
    practice: true,
    context: 'Visitors must sign in at reception before entering the offices.',
    question: 'What does the rule require of a visitor?',
    options: [
      'Signing in at reception before entering',
      'Leaving the building by the reception exit',
      'Wearing a visitor badge at all times',
      'Booking a visit a day in advance',
    ],
    key: 0,
    rationale: 'The rule requires only signing in at reception before entering; it says nothing about badges, exits or booking.',
  }),
  bankItem({
    slug: 'practice-choir',
    facet: 'quantifiers',
    b: -2,
    practice: true,
    context: 'Every member of the choir sings in the spring concert. Tom is a member of the choir.',
    question: 'Which statement must be true?',
    options: [
      'Tom sings a solo in the concert',
      'Tom does not sing in the concert',
      'Tom sings in the spring concert',
      'Tom organises the spring concert',
    ],
    key: 2,
    rationale: 'Every member sings in the concert and Tom is a member, so Tom sings in it. Nothing is said about solos or organising.',
  }),

  /* ------------------------------------------------------------- quantifiers */
  bankItem({
    slug: 'rooms-with-windows',
    facet: 'quantifiers',
    b: -0.8,
    context: 'All the rooms on the second floor have a window. Room 12 has no window.',
    question: 'Which statement must be true?',
    options: [
      'Room 12 is on the first floor',
      'Room 12 is not on the second floor',
      'Some second-floor rooms have no window',
      'Room 12 has a skylight instead',
    ],
    key: 1,
    rationale:
      'If Room 12 were on the second floor it would have a window, so it is not on that floor. Which other floor it is on is not stated.',
  }),
  bankItem({
    slug: 'volunteer-teachers',
    facet: 'quantifiers',
    b: -0.2,
    context: 'Some of the volunteers are teachers. All of the teachers speak Spanish.',
    question: 'Which statement must be true?',
    options: [
      'All of the volunteers speak Spanish',
      'Some Spanish speakers are not teachers',
      'No volunteer speaks another language',
      'At least one volunteer speaks Spanish',
    ],
    key: 3,
    rationale:
      'The volunteers who are teachers speak Spanish, and there is at least one of them. Nothing is said about the volunteers who are not teachers.',
  }),
  bankItem({
    slug: 'only-members-tents',
    facet: 'quantifiers',
    b: 0.7,
    context: 'Only members may borrow the club’s tents.',
    question: 'Which statement follows from the rule?',
    options: [
      'Anyone who borrows a tent is a member',
      'Every member may borrow a tent',
      'Members must borrow a tent each year',
      'Non-members may borrow one if a member asks',
    ],
    key: 0,
    rationale:
      '‘Only members may’ means borrowing requires membership, so every borrower is a member. It does not grant every member the right to borrow.',
  }),
  bankItem({
    slug: 'at-most-two-absent',
    facet: 'quantifiers',
    b: 1.1,
    context: 'At most two of the five committee members may be absent from any vote. At yesterday’s vote, Ana was absent.',
    question: 'If the rule was followed, which must be true?',
    options: [
      'Ana was the only member who was absent',
      'Exactly one other member was absent',
      'At least three members were present',
      'At least four members were present',
    ],
    key: 2,
    rationale:
      'With at most two of five absent, at least three were present. One more member could also have been absent, so ‘at least four’ and ‘Ana was the only one’ are not guaranteed.',
  }),
  bankItem({
    slug: 'deadline-chain',
    facet: 'quantifiers',
    b: 2.1,
    context:
      'No applicant who missed the deadline will be interviewed. Only interviewed applicants can be hired. Some applicants who applied early were not interviewed.',
    question: 'Which statement must be true?',
    options: [
      'Every applicant who met the deadline was interviewed',
      'Every hired applicant met the deadline',
      'Some early applicants were hired',
      'No early applicant was hired',
    ],
    key: 1,
    rationale:
      'A hired applicant was interviewed, and an interviewed applicant cannot have missed the deadline. The rules never say that meeting the deadline guarantees an interview, and whether any early applicant was hired is left open.',
  }),
  bankItem({
    slug: 'board-engineers',
    facet: 'quantifiers',
    b: 2.9,
    context:
      'A five-member board must include at least two engineers and at most one member under 25. Any member under 25 must be an engineer. The current board meets these rules and has exactly two engineers.',
    question: 'Which statement must be true?',
    options: [
      'One of the two engineers is under 25',
      'No member of the board is under 25',
      'Exactly one board member is under 25',
      'Every non-engineer on the board is 25 or over',
    ],
    key: 3,
    rationale:
      'Anyone under 25 must be an engineer, so the three non-engineers are all 25 or over. Whether one of the engineers is under 25 is left open, so the options about the under-25 count are not guaranteed.',
  }),

  /* ------------------------------------------------------------------- scope */
  bankItem({
    slug: 'not-all-trains',
    facet: 'scope',
    b: -0.3,
    context: 'Not all of today’s trains are delayed.',
    question: 'Which statement is implied?',
    options: [
      'At least one of today’s trains is not delayed',
      'None of today’s trains is delayed',
      'Most, but not all, of today’s trains are delayed',
      'At least one of today’s trains is delayed',
    ],
    key: 0,
    rationale:
      '‘Not all are delayed’ means at least one is not delayed. It does not say whether any train is delayed, so the last option is not implied.',
  }),
  bankItem({
    slug: 'no-door-unlocked',
    facet: 'scope',
    b: 0.2,
    context: 'None of the doors may be left unlocked after 10 pm.',
    question: 'What does the rule require?',
    options: [
      'At least one door must be locked after 10 pm',
      'No door may be locked after 10 pm',
      'Every door must be locked after 10 pm',
      'Doors may stay unlocked if someone is inside',
    ],
    key: 2,
    rationale:
      'If no door may be left unlocked, every door must be locked. Requiring only one locked door would allow the others to stay unlocked, which the rule forbids.',
  }),
  bankItem({
    slug: 'not-required-briefing',
    facet: 'scope',
    b: 0.4,
    context: 'Staff are not required to attend the Friday briefing.',
    question: 'Which statement follows?',
    options: [
      'Staff are not allowed to attend the briefing',
      'Staff may choose not to attend the briefing',
      'Staff should attend only if they are invited',
      'Staff must attend a different briefing instead',
    ],
    key: 1,
    rationale:
      'Removing a requirement makes attendance optional; it does not forbid attending. ‘Not required to attend’ is not the same as ‘required not to attend’.',
  }),
  bankItem({
    slug: 'need-not-both',
    facet: 'scope',
    b: 1.2,
    context: 'Members must either pay the fee or attend the induction, but they need not do both.',
    question: 'Which member has broken the rule?',
    options: [
      'Ada, who paid the fee but skipped the induction',
      'Ben, who attended the induction but did not pay',
      'Dee, who paid the fee and attended the induction',
      'Cam, who neither paid nor attended the induction',
    ],
    key: 3,
    rationale:
      'The rule requires at least one of the two, so only Cam breaks it. ‘Need not do both’ means doing both is not required, not that it is forbidden, so Dee is within the rule.',
  }),
  bankItem({
    slug: 'badge-not-enough',
    facet: 'scope',
    b: 1.4,
    context: 'Nobody may enter without a badge, and not everyone with a badge may enter.',
    question: 'Which statement must be true?',
    options: [
      'A badge is needed to enter but may not be enough',
      'Anyone who holds a badge is allowed to enter',
      'Some people without a badge may still enter',
      'No one who holds a badge is allowed to enter',
    ],
    key: 0,
    rationale:
      'The first clause makes a badge necessary; the second says some badge holders may still not enter. ‘Not everyone with a badge’ does not mean ‘no one with a badge’.',
  }),
  bankItem({
    slug: 'not-only-managers',
    facet: 'scope',
    b: 1.9,
    context: 'It is not true that only managers can approve refunds.',
    question: 'Which statement follows?',
    options: [
      'Managers are not able to approve any refunds',
      'Every employee is able to approve refunds',
      'Some non-managers are able to approve refunds',
      'No refund can be approved by anyone at all',
    ],
    key: 2,
    rationale:
      'Denying ‘only managers can’ means someone who is not a manager can. It says nothing against managers approving refunds, and it does not extend the power to every employee.',
  }),
  bankItem({
    slug: 'vegetarian-and-quick',
    facet: 'scope',
    b: 2.0,
    context: 'It is not the case that every recipe in the book is both vegetarian and quick.',
    question: 'Which statement must be true?',
    options: [
      'Some recipe is neither vegetarian nor quick',
      'Some recipe is not vegetarian or is not quick',
      'No recipe is both vegetarian and quick',
      'At least one recipe is not vegetarian',
    ],
    key: 1,
    rationale:
      'At least one recipe fails to be both, so it lacks at least one of the two qualities. It need not lack both, and the failing quality could be speed rather than being vegetarian.',
  }),

  /* -------------------------------------------------------------- conditions */
  bankItem({
    slug: 'rain-indoors',
    facet: 'conditions',
    b: -1.2,
    context: 'If it rains, the match is moved indoors. It is raining.',
    question: 'What follows?',
    options: ['The match is cancelled', 'The match stays outdoors', 'The match is moved indoors', 'The match is postponed to Sunday'],
    key: 2,
    rationale: 'The condition is met, so the stated consequence follows: the match is moved indoors.',
  }),
  bankItem({
    slug: 'courier-parcel',
    facet: 'conditions',
    b: 0.5,
    context: 'If a parcel weighs over 2 kg, it must be sent by courier. This parcel was sent by courier.',
    question: 'What follows about the parcel’s weight?',
    options: ['Nothing follows about its weight', 'It weighs over 2 kg', 'It weighs no more than 2 kg in total', 'It weighs exactly 2 kg'],
    key: 0,
    rationale:
      'The rule says heavy parcels must go by courier; it does not say only heavy parcels may. A lighter parcel can also be sent by courier, so nothing follows about the weight.',
  }),
  bankItem({
    slug: 'gate-unless-guard',
    facet: 'conditions',
    b: 0.8,
    context: 'The gate stays locked unless a guard is present.',
    question: 'The gate is unlocked. If the rule holds, which must be true?',
    options: ['No guard is present', 'A guard unlocked the gate', 'The gate will be locked soon', 'A guard is present'],
    key: 3,
    rationale:
      'Without a guard the gate stays locked, so an unlocked gate means a guard is present. The rule does not say who unlocked it.',
  }),
  bankItem({
    slug: 'hike-conditions',
    facet: 'conditions',
    b: 1.2,
    context: 'The hike goes ahead only if at least five people sign up and no storm is forecast.',
    question: 'The hike went ahead. Which must be true?',
    options: [
      'Five or more signed up and no storm was forecast',
      'Exactly five people signed up for the hike that day',
      'Either five signed up or no storm was forecast',
      'No storm occurred at any point during the hike',
    ],
    key: 0,
    rationale:
      'Both conditions are necessary, so both held. The rule concerns the forecast, not the weather that actually occurred, and ‘at least five’ allows more than five.',
  }),
  bankItem({
    slug: 'survey-approval',
    facet: 'conditions',
    b: 1.3,
    context:
      'Unless and until the survey is approved, no data may be collected. After approval, data may be collected on weekdays, and at weekends only if the lead researcher is present.',
    question: 'Which of these is permitted?',
    options: [
      'Tuesday, before approval, with the lead researcher present',
      'Sunday, after approval, with the lead researcher present',
      'Saturday, after approval, without the lead researcher',
      'Sunday, before approval, with the lead researcher present',
    ],
    key: 1,
    rationale:
      'Collection before approval is never allowed, and after approval weekend collection needs the lead researcher. Only the Sunday session after approval with the researcher present meets both conditions.',
  }),
  bankItem({
    slug: 'loan-refused-unless',
    facet: 'conditions',
    b: 2.3,
    context: 'A loan request is refused unless the applicant has both a guarantor and a steady income.',
    question: 'Which statement follows?',
    options: [
      'Any applicant with a guarantor is approved',
      'Any applicant with a steady income is approved',
      'Any approved applicant has a guarantor',
      'Any refused applicant lacks a guarantor',
    ],
    key: 2,
    rationale:
      'Having both is necessary for approval, so an approved applicant has a guarantor (and a steady income). It is not sufficient for approval, and a refused applicant may have been missing only the income.',
  }),
  bankItem({
    slug: 'guest-registration',
    facet: 'conditions',
    b: 2.2,
    context:
      'No more than two guests may stay overnight unless and until the host has registered with the building office; after that, up to four may stay, provided none stays more than three nights in a row. The host registered on Tuesday morning.',
    question: 'Which situation breaks the rule?',
    options: [
      'Four guests stayed on the Tuesday night',
      'Four guests stayed Wednesday, Thursday and Friday nights',
      'Two guests stayed on the Sunday and Monday nights',
      'Three guests stayed on the Monday night',
    ],
    key: 3,
    rationale:
      'Before Tuesday morning the limit was two guests, so three on Monday night breaks it. Three nights in a row is allowed, since only more than three is forbidden.',
  }),
  bankItem({
    slug: 'fire-team-alarm',
    facet: 'conditions',
    b: 3.1,
    context:
      'When the alarm sounds, everyone must leave the building unless they are on the fire team. Fire-team members are required to leave only if the alarm sounds twice.',
    question: 'The alarm sounded once. Who broke the rule?',
    options: [
      'A fire-team member who left the building',
      'A non-member of the fire team who stayed',
      'A fire-team member who stayed inside',
      'A non-member of the fire team who left',
    ],
    key: 1,
    rationale:
      'Everyone outside the fire team had to leave, so a non-member who stayed broke the rule. For fire-team members, one alarm creates no requirement either way, so leaving is not forbidden.',
  }),

  /* ------------------------------------------------------------ instructions */
  bankItem({
    slug: 'bike-rack',
    facet: 'instructions',
    b: -1.2,
    context: 'Bikes must be locked to the rack, not to the railings.',
    question: 'Which of these is permitted?',
    options: [
      'Locking a bike to the rack',
      'Locking a bike to the railings',
      'Leaving a bike unlocked by the railings',
      'Leaving a bike unlocked in the rack',
    ],
    key: 0,
    rationale: 'The rule requires bikes to be locked, and to the rack. Every other option breaks one of those two parts.',
  }),
  bankItem({
    slug: 'meal-claims',
    facet: 'instructions',
    b: -0.4,
    context: 'Each employee may claim up to three meals per trip, and no single meal may cost more than 25 euros.',
    question: 'Which claim for one trip is allowed?',
    options: [
      'Four meals costing 10 euros each',
      'One meal costing 30 euros',
      'Two meals costing 20 euros each',
      'Three meals of 20 euros and one of 5',
    ],
    key: 2,
    rationale:
      'Two meals of 20 euros stay within both the three-meal limit and the 25-euro cap. Four meals exceed the count even when each is cheap.',
  }),
  bankItem({
    slug: 'library-laptops',
    facet: 'instructions',
    b: 0.5,
    context:
      'Library laptops may be taken home overnight on weekdays. At weekends they must stay in the building, except that staff may take them home on Saturday nights.',
    question: 'Which of these is permitted?',
    options: [
      'A student taking one home on Saturday night',
      'A staff member taking one home late on Sunday night',
      'A student taking one home on Sunday night',
      'A staff member taking one home on Saturday night',
    ],
    key: 3,
    rationale:
      'The only weekend exception is for staff on Saturday nights. Sunday nights allow no exception, even for staff.',
  }),
  bankItem({
    slug: 'application-language',
    facet: 'instructions',
    b: 0.9,
    context:
      'Applications must be written in English or French. Applications in French must also include an English summary of no more than 200 words.',
    question: 'Which application meets the requirements?',
    options: [
      'In French, with a 300-word English summary',
      'In English, with no summary',
      'In French, with no summary at all',
      'In German, with a 150-word English summary',
    ],
    key: 1,
    rationale:
      'The summary is required only for French applications, so an English application needs none. The French options break the summary rule, and German is not allowed.',
  }),
  bankItem({
    slug: 'wall-colour',
    facet: 'instructions',
    b: 1.7,
    context:
      'Tenants may paint their walls any colour, but must repaint them white before moving out unless the landlord has agreed in writing to keep the new colour.',
    question: 'Which tenant broke the rule?',
    options: [
      'Ana: painted green; landlord agreed in writing; left it green',
      'Ben: painted blue; no agreement; repainted white before leaving',
      'Cleo: painted yellow; landlord agreed by phone; left it yellow',
      'Dev: never painted; landlord said nothing; left walls unchanged',
    ],
    key: 2,
    rationale:
      'Only a written agreement removes the duty to repaint, and Cleo’s agreement was by phone. Dev never painted, so there was nothing to repaint.',
  }),
  bankItem({
    slug: 'delivery-bays',
    facet: 'instructions',
    b: 1.9,
    context:
      'Delivery bays may be used only by delivery vehicles. Between 6 am and 10 am, no vehicle may stay in a delivery bay for more than 20 minutes.',
    question: 'Which of these breaks the rule?',
    options: [
      'A delivery van in a delivery bay for 25 minutes at 9 am',
      'A delivery van in a delivery bay for 25 minutes at 2 pm',
      'A delivery van in a delivery bay for 15 minutes at 7 am',
      'A private car in an ordinary bay for two hours at 8 am',
    ],
    key: 0,
    rationale:
      'The 20-minute limit applies between 6 am and 10 am, so 25 minutes at 9 am breaks it. At 2 pm the time limit does not apply, and ordinary bays are not covered at all.',
  }),
];

export const reading = bankParadigm<BankContent>({
  id: 'reading',
  version: 1,
  domain: 'language',
  group: 'core',
  load: 'reasoning',
  title: 'Precise reading',
  subtitle: 'Read exactly what the rule says. No more, no less.',
  construct: 'Precise comprehension of quantifiers, negation, conditions and written rules.',
  instructions: [
    'Each item gives a short rule or statement.',
    'Answer only from what the text says, not from what usually happens.',
    'Watch words such as only, unless, at most and not all.',
  ],
  minutes: 6,
  minRtMs: 3000,
  items: readingItems,
  facetTargets: {
    quantifiers: 0.25,
    scope: 0.25,
    conditions: 0.25,
    instructions: 0.25,
  },
  defaultA: 1.4,
  defaultTimeLimitMs: 90_000,
});
