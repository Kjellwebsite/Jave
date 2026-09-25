/**
 * Strategic scenarios: authored situations whose best choice follows from
 * stated points and rules. Written without game-theory vocabulary; every key
 * is the unique best choice under the stated assumptions.
 */
import { bankParadigm } from '../paradigm';
import { bankItem, type BankContent, type BankItem } from './content';

const RATIONAL = 'Everyone wants to maximise their own points and knows the others do too.';

export const strategicItems: BankItem[] = [
  /* ---------------------------------------------------------------- practice */
  bankItem({
    slug: 'practice-match-colour',
    facet: 'best-response',
    b: -2,
    practice: true,
    context:
      'Kai has already chosen Red, and you can see his choice. You score 5 points if you choose the same colour as Kai and 0 otherwise.',
    question: 'Which colour should you choose?',
    options: ['Blue', 'Green', 'Red', 'Yellow'],
    key: 2,
    rationale: 'Only matching Kai’s Red scores points, and you already know his choice.',
  }),
  bankItem({
    slug: 'practice-safe-bid',
    facet: 'auctions',
    b: -2,
    practice: true,
    context:
      'A lamp is worth exactly 30 points to you. In a sale where the highest bidder wins and pays their own bid, you must choose a bid.',
    question: 'Which bid is the only one that cannot leave you with a loss if you win?',
    options: ['35', '25', '40', '50'],
    key: 1,
    rationale: 'Winning with any bid above 30 means paying more than the lamp is worth to you; only 25 is below 30.',
  }),

  /* ----------------------------------------------------------- best-response */
  bankItem({
    slug: 'after-seeing-choice',
    facet: 'best-response',
    b: -1.2,
    context:
      'Nia chooses Left or Right, and then you choose Up or Down after seeing her choice. If she chose Left, Up gives you 3 points and Down gives you 5. If she chose Right, Up gives you 4 and Down gives you 2. Nia chose Right.',
    question: 'What should you choose?',
    options: ['Down, for 5 points', 'Up, for 4 points', 'Down, for 2 points', 'Up, for 3 points'],
    key: 1,
    rationale:
      'Nia chose Right, so only the Right payoffs matter: Up gives 4 and Down gives 2. The 5 points for Down apply only if she had chosen Left.',
  }),
  bankItem({
    slug: 'cafe-prices',
    facet: 'best-response',
    b: 0.3,
    context:
      'Two cafés on the same street each set a price, Low or High, at the same time. Your daily points: you Low and rival Low, 4; you Low and rival High, 7; you High and rival Low, 2; you High and rival High, 5.',
    question: 'Which statement about your choice is correct?',
    options: [
      'High is better, whatever the rival does',
      'Low is better only if the rival picks Low',
      'High is better only if the rival picks High',
      'Low is better, whatever the rival does',
    ],
    key: 3,
    rationale:
      'Against Low, Low gives 4 versus 2; against High, Low gives 7 versus 5. Low wins in both cases, so it is best whatever the rival chooses.',
  }),
  bankItem({
    slug: 'safe-or-bold',
    facet: 'best-response',
    b: 1.0,
    context:
      'You choose Safe or Bold. Safe always gives 4 points. Bold gives 10 points if your opponent chooses Pass and 0 if they choose Block. Your opponent chooses Block 7 times out of 10, at random, whatever you do. You want the highest average score over many rounds.',
    question: 'What should you choose?',
    options: [
      'Safe, since Bold averages only 3 points',
      'Bold, since 10 points is the largest prize',
      'Bold, since it averages 5 points a round',
      'Either, since both average 4 points',
    ],
    key: 0,
    rationale:
      'Bold pays 10 only 3 times in 10, an average of 3, which is less than Safe’s sure 4. The size of the largest prize does not matter once its chance is taken into account.',
  }),
  bankItem({
    slug: 'first-mover-anticipates',
    facet: 'best-response',
    b: 1.4,
    context: `Ola chooses A or B. You see her choice and then choose X or Y. Points (Ola, you): A then X gives (3, 1); A then Y gives (0, 2); B then X gives (2, 3); B then Y gives (1, 0). ${RATIONAL}`,
    question: 'What will happen?',
    options: ['Ola picks A, and you pick X', 'Ola picks A, and you pick Y', 'Ola picks B, and you pick X', 'Ola picks B, and you pick Y'],
    key: 2,
    rationale:
      'After A you would pick Y (2 beats 1), leaving Ola 0; after B you would pick X (3 beats 0), leaving her 2. So Ola picks B. Her tempting 3 after A never happens, because you would not pick X there.',
  }),

  /* -------------------------------------------------------------- commitment */
  bankItem({
    slug: 'landlord-threat',
    facet: 'commitment',
    b: 0.4,
    context:
      'A landlord tells a tenant: ‘If your rent is ever one day late, I’ll evict you and leave the flat empty for a year.’ Both know that eviction would cost the landlord large legal fees and that an empty flat earns him nothing.',
    question: 'Why should the tenant not take this threat seriously?',
    options: [
      'The tenant may not value living in this flat very highly',
      'Carrying it out would cost the landlord more than it gains him',
      'The landlord has probably evicted other tenants in the past',
      'The punishment threatened is too mild to change anything',
    ],
    key: 1,
    rationale:
      'Once the rent is a day late, evicting would cost the landlord legal fees and a year of rent, so he would not follow through. A past record of evictions would make the threat more believable, not less.',
  }),
  bankItem({
    slug: 'bakery-price-war',
    facet: 'commitment',
    b: 1.2,
    context: `Birk runs the only bakery in town. Cato is deciding whether to open a second. If Cato opens, Birk can start a price war (Birk 1 point, Cato −2) or share the market (Birk 4, Cato 3). If Cato stays out, Birk gets 9 and Cato 0. Birk announces: ‘If you open, I’ll start a price war.’ ${RATIONAL}`,
    question: 'What should Cato do, and why?',
    options: [
      'Open, since Birk would then earn more by sharing',
      'Stay out, since a price war would cost Cato 2 points',
      'Stay out, since Birk has publicly promised a price war',
      'Stay out, since Birk earns more when there is no rival',
    ],
    key: 0,
    rationale:
      'Once Cato has opened, Birk chooses between 1 point from a price war and 4 from sharing, so he will share and Cato gets 3. The announcement costs Birk nothing and changes none of the points, so it is not believable.',
  }),
  bankItem({
    slug: 'custom-table',
    facet: 'commitment',
    b: 2.2,
    context:
      'Mila agrees to build a table for 900 to fit Oren’s oddly shaped room. Anyone else would pay at most 200 for it. Once it is built, Oren says he will pay only 400. A court case would cost each of them more than it could win. Both want as much money as possible and know the other does too.',
    question: 'Which arrangement, agreed at the start, would best have protected Mila?',
    options: [
      'A higher agreed price of 1,200 instead of 900',
      'A written promise from Oren that he will be fair',
      'A shorter building time, so he has less time to plan',
      'Most of the payment made before she starts work',
    ],
    key: 3,
    rationale:
      'Once built, the table is worth only 200 elsewhere, so Oren can push Mila down towards that figure; payment in advance takes that power away. A higher price or a promise can be renegotiated in exactly the same way once the table exists.',
  }),
  bankItem({
    slug: 'ferry-contract',
    facet: 'commitment',
    b: 2.9,
    context: `Dalia runs the only ferry on a route. Evan is deciding whether to start a rival service. If Evan enters, Dalia can cut fares (Dalia 2 points, Evan −1) or keep fares (Dalia 5, Evan 3). If Evan stays out, Dalia gets 8 and Evan 0. Before Evan decides, Dalia signs a binding public contract to pay the port 4 points if she ever keeps fares unchanged after a rival enters. ${RATIONAL}`,
    question: 'What should Evan do now?',
    options: [
      'Enter, since keeping fares still gives Dalia 5 rather than 2',
      'Enter, since the contract has already cost Dalia 4 points',
      'Stay out, since Dalia would now do better by cutting fares',
      'Enter, since Dalia’s threat to cut fares cannot be believed',
    ],
    key: 2,
    rationale:
      'With the contract, keeping fares gives Dalia 5 − 4 = 1, less than the 2 from cutting, so she will cut and Evan would get −1. The contract costs her nothing unless she keeps fares, which is exactly what makes her threat believable.',
  }),

  /* -------------------------------------------------------------- signalling */
  bankItem({
    slug: 'visible-project',
    facet: 'signalling',
    b: -0.3,
    context:
      'Two job candidates both say they are hard-working. One of them, Jade, has also completed a demanding six-month unpaid project in her own time, and it is publicly visible online.',
    question: 'Why is Jade’s project more convincing than the claim alone?',
    options: [
      'It would have been hard to finish without real effort',
      'Employers value unpaid work more than paid work',
      'Anything posted online is sure to be seen by them',
      'It shows that she has more free time than others',
    ],
    key: 0,
    rationale:
      'Anyone can say they are hard-working, but finishing a demanding six-month project takes the very effort being claimed. Having free time does not show hard work, and posting online guarantees nothing.',
  }),
  bankItem({
    slug: 'repair-guarantee',
    facet: 'signalling',
    b: 0.9,
    context:
      'Two used-bike sellers at a market offer bikes that look identical. Seller A gives a free 12-month repair guarantee; Seller B does not. Repairing a bad bike would cost more than the price it sells for.',
    question: 'What does Seller A’s guarantee most reliably tell a buyer?',
    options: [
      'Seller A has more money than Seller B',
      'Seller B’s bikes are certainly faulty',
      'Seller A expects few of the bikes to need repairs',
      'Seller A’s bikes cost more to buy in the first place',
    ],
    key: 2,
    rationale:
      'Offering the guarantee on bad bikes would cost Seller A more than each sale earns, so only a seller confident in the bikes would offer it. Seller B may simply not offer guarantees, so calling B’s bikes certainly faulty goes too far.',
  }),
  bankItem({
    slug: 'training-course',
    facet: 'signalling',
    b: 2.2,
    context:
      'Volunteers may take a 40-hour course before applying to a rescue team. For experienced volunteers the course costs effort worth 10 points; for inexperienced ones, 30 points. The team gives benefits worth 20 points to anyone it believes is experienced, and nothing otherwise. Everyone knows these numbers and wants to maximise their own points.',
    question: 'Which outcome makes sense for everyone, given these numbers?',
    options: [
      'Everyone takes the course, since the benefit is 20 points',
      'Only experienced volunteers take it, and the team trusts it',
      'Nobody takes the course, since it always costs effort',
      'Only inexperienced volunteers take it, to catch up',
    ],
    key: 1,
    rationale:
      'An experienced volunteer gains 20 − 10 = 10 by taking the course; an inexperienced one would lose 30 − 20 = 10, so only experienced volunteers take it and the team can rely on it. If everyone took it, the team could no longer tell them apart and would stop paying the 20.',
  }),
  bankItem({
    slug: 'lavish-launch',
    facet: 'signalling',
    b: 2.4,
    context:
      'A new restaurant spends a very large sum on a lavish launch party. The party says nothing about the food, and its cost can be recovered only if many diners keep coming back for months. Diners know this.',
    question: 'What can a diner reasonably infer from the lavish launch?',
    options: [
      'The restaurant’s prices will be lower than elsewhere',
      'The owner is hiding weak food behind a big show',
      'The party itself proves the chef is highly skilled',
      'The owner expects diners to like the food and return',
    ],
    key: 3,
    rationale:
      'Spending that pays off only through repeat visits makes sense only for an owner who expects people to come back, which depends on the food. An owner hiding weak food would never recover the cost, so the spending would not make sense for them.',
  }),

  /* ------------------------------------------------------------ coordination */
  bankItem({
    slug: 'festival-gate',
    facet: 'coordination',
    b: -1.0,
    context:
      'You and a friend get separated at a crowded festival and both phones are dead. Before arriving, you both agreed: ‘If we lose each other, meet at the main gate.’ You both want to meet as quickly as possible.',
    question: 'Where should you go?',
    options: ['To the food tents', 'To the stage where you were separated', 'To the main gate', 'Stay exactly where you are'],
    key: 2,
    rationale:
      'The agreement makes the main gate the place each of you expects the other to go. Any other choice relies on guessing what your friend will improvise.',
  }),
  bankItem({
    slug: 'hall-or-park',
    facet: 'coordination',
    b: -0.2,
    context: `You and a colleague each choose, without talking, to go to the Hall or the Park. If you both pick the Hall, you each get 6 points; if you both pick the Park, 3 each; if you pick different places, 0 each. ${RATIONAL}`,
    question: 'What should you choose?',
    options: [
      'The Hall, since both of you do best meeting there',
      'The Park, since it is the safer of the two places',
      'Either, since it is a pure coin flip',
      'Whichever your colleague is less likely to choose',
    ],
    key: 0,
    rationale:
      'Meeting at the Hall is better for both of you than meeting at the Park, and each knows the other sees this, so both can expect the Hall. The Park is not safer: a mismatch gives 0 wherever you go.',
  }),
  bankItem({
    slug: 'shared-fence',
    facet: 'coordination',
    b: 0.9,
    context:
      'Three neighbours share a fence. It is repaired only if at least two of them contribute. Contributing costs each contributor 2 points, and a repaired fence gives all three 5 points each, whether or not they paid. Ana has already paid, and Bo has definitely refused.',
    question: 'What gives you the most points?',
    options: [
      'Refuse, since Ana’s payment will cover the repair',
      'Refuse, since the repair gives you 5 points anyway',
      'Wait, since Bo may change his mind later on',
      'Pay, since your payment alone decides the repair',
    ],
    key: 3,
    rationale:
      'With Bo out, the fence is repaired only if you pay: paying gives 5 − 2 = 3, refusing gives 0. Ana’s payment alone is not enough, since two contributors are needed.',
  }),
  bankItem({
    slug: 'closed-cafe',
    facet: 'coordination',
    b: 1.5,
    context:
      'You and a colleague agreed to meet at Café North at noon; neither of you can phone the other. At 11 the manager messages you both: ‘Café North is closed today. I am sending this same message to both of you.’ You each read it at once. Café South is the only other café nearby.',
    question: 'Where should you go?',
    options: [
      'Café North, since that was the agreed plan',
      'Café South, since you both know the other knows',
      'Café North, since you can wait outside together',
      'The office, since the plan has fallen apart',
    ],
    key: 1,
    rationale:
      'The message says it went to both of you, so each knows the other knows North is closed and that South is the only other option. Keeping to the old plan made sense only if your colleague might be unaware, which the message rules out.',
  }),

  /* ------------------------------------------------------ iterated-dominance */
  bankItem({
    slug: 'street-spots',
    facet: 'iterated-dominance',
    b: 0.9,
    context:
      'Two stalls each choose a spot on a street: West, Centre or East, equally spaced. Shoppers are spread evenly along the street and walk to the nearer stall; if both choose the same spot, they split the shoppers equally. Each stall wants as many shoppers as possible.',
    question: 'Which spot should a stall choose?',
    options: [
      'West, since fewer rivals choose the ends',
      'East, since it is farther from the rival',
      'Centre, since it does better wherever the rival is',
      'Any spot, since the shoppers are always split in half',
    ],
    key: 2,
    rationale:
      'Against a rival at West or East, Centre wins two-thirds of the shoppers, more than any other spot; against a rival at Centre it still wins half rather than a third. So Centre is best whatever the rival does.',
  }),
  bankItem({
    slug: 'race-to-eleven',
    facet: 'iterated-dominance',
    b: 2.0,
    context:
      'Two players take turns adding 1, 2 or 3 to a running total that starts at 0. Whoever brings the total to exactly 11 wins. You go first, and both players play perfectly.',
    question: 'What should you add on your first turn?',
    options: ['Add 1', 'Add 2', 'Any amount; the second player always wins', 'Add 3'],
    key: 3,
    rationale:
      'Whoever reaches 7 can always reach 11 next turn, because the opponent adds 1–3 and you add the rest of 4; by the same logic 3 is a winning total. So add 3 now, then make each pair of turns add up to 4.',
  }),
  bankItem({
    slug: 'two-step-elimination',
    facet: 'iterated-dominance',
    b: 2.3,
    context: `Kai chooses Top or Bottom while Lin chooses Left, Middle or Right, at the same time. Lin’s points: Left gives 4 if Kai picks Top and 0 if Bottom; Middle gives 2 either way; Right gives 1 either way. Kai’s points: Top gives 3 against Left or Middle and 0 against Right; Bottom gives 1 against Left or Middle and 5 against Right. ${RATIONAL}`,
    question: 'What will they choose?',
    options: ['Top and Left', 'Top and Middle', 'Bottom and Right', 'Bottom and Middle'],
    key: 0,
    rationale:
      'Right always gives Lin less than Middle, so Kai can rule it out; then Top beats Bottom for Kai against both Left and Middle. Knowing Kai picks Top, Lin prefers Left (4) to Middle (2). Bottom’s 5 relies on Lin choosing Right, which she never would.',
  }),
  bankItem({
    slug: 'last-coin-loses',
    facet: 'iterated-dominance',
    b: 3.3,
    context:
      'There are 10 coins on a table. Two players take turns removing 1, 2 or 3 coins. Whoever takes the last coin loses. You move first, and both players play perfectly.',
    question: 'How many coins should you take on your first turn?',
    options: ['Take 3', 'Take 1', 'Take 2', 'Any amount; the second player always wins'],
    key: 1,
    rationale:
      'Leaving your opponent exactly 1 coin wins, and so does leaving 5 or 9, because whatever they take you can make each pair of turns remove 4. From 10, taking 1 leaves 9; taking 2 or 3 leaves 8 or 7, from which the opponent can leave you 5.',
  }),

  /* ---------------------------------------------------------------- auctions */
  bankItem({
    slug: 'rising-price',
    facet: 'auctions',
    b: -0.6,
    context:
      'In an open auction, the price rises in steps of 1 and each bidder drops out whenever they like; the last one left wins at the current price. A lamp is worth exactly 50 to you, whatever others think of it.',
    question: 'When should you drop out?',
    options: [
      'As soon as another bidder joins in',
      'When the price reaches 25, half its value',
      'Never, so that you are sure to win',
      'When the price would go above 50',
    ],
    key: 3,
    rationale:
      'Below 50, staying in can only lead to a purchase worth more to you than you pay; above 50, any win is a loss. Dropping out earlier throws away purchases that would have been worth making.',
  }),
  bankItem({
    slug: 'pay-second-bid',
    facet: 'auctions',
    b: 1.8,
    context:
      'In a sealed-bid auction, the highest bidder wins but pays the second-highest bid. A painting is worth exactly 70 to you. You do not know the other bids.',
    question: 'What should you bid?',
    options: [
      'Exactly 70',
      'A little under 70, to keep some profit',
      'A little over 70, to improve your chances',
      'The average of what you expect others to bid',
    ],
    key: 0,
    rationale:
      'Your bid decides only whether you win, not what you pay. Bidding 70 wins exactly when the price is below 70; bidding less risks losing profitable wins, and bidding more risks winning at a loss.',
  }),
  bankItem({
    slug: 'overbid-to-be-safe',
    facet: 'auctions',
    b: 2.2,
    context:
      'In a sealed-bid auction where the highest bidder wins but pays the second-highest bid, Tess values a clock at 100. To be safe, she bids 130. The other bids are 90 and 115.',
    question: 'What is the result for Tess?',
    options: [
      'She wins, pays 130, and is 30 worse off',
      'She wins, pays 90, and is 10 better off',
      'She wins, pays 115, and is 15 worse off',
      'She loses, because her value was below 115',
    ],
    key: 2,
    rationale:
      'Her 130 is the highest bid, so she wins and pays the second-highest bid, 115, which is 15 more than the clock is worth to her. Had she bid her value of 100, she would have lost to 115 and lost nothing.',
  }),
  bankItem({
    slug: 'jar-of-coins',
    facet: 'auctions',
    b: 2.8,
    context:
      'Five people bid for a sealed jar of coins. Each has made an honest estimate of its value; on average the estimates are right, but some are too high and some too low. The highest bidder wins and pays their bid.',
    question: 'Why should a bidder bid below their own estimate?',
    options: [
      'Their own estimate is, on the whole, likely to be too high',
      'Winning suggests their estimate was among the highest',
      'The others will all bid exactly their estimates',
      'The jar is worth less to the winner than to others',
    ],
    key: 1,
    rationale:
      'Estimates are right on average, but the winner is whoever estimated highest, so a winning estimate is probably too high. Each estimate taken alone is unbiased, which is why the first option is wrong.',
  }),

  /* --------------------------------------------------------------- bargaining */
  bankItem({
    slug: 'camera-price',
    facet: 'bargaining',
    b: 0.5,
    context:
      'Hana is selling a used camera. Her buyer, Ivo, can buy an identical camera elsewhere for 300. If Ivo does not buy, Hana’s next best buyer would pay 200.',
    question: 'Within which range can a price leave both Hana and Ivo at least as well off as their alternatives?',
    options: ['Between 200 and 300', 'Only at exactly 250', 'Anywhere above 300', 'Anywhere below 200'],
    key: 0,
    rationale:
      'Hana will not accept less than the 200 she can get elsewhere, and Ivo will not pay more than the 300 he could pay elsewhere. Any price between the two works for both; 250 is only one of them.',
  }),
  bankItem({
    slug: 'cost-of-delay',
    facet: 'bargaining',
    b: 0.8,
    context:
      'Two firms are negotiating a contract. Each day without agreement costs Firm A 5 points and Firm B 1 point, and both know this. Otherwise they are in the same position.',
    question: 'Which firm is in the stronger bargaining position?',
    options: [
      'Firm A, since it loses more and so cares more',
      'Neither, since both lose something from delay',
      'Firm B, since delay hurts it less than Firm A',
      'Firm A, since it can offer to pay more per day',
    ],
    key: 2,
    rationale:
      'The side that loses less from waiting can hold out longer, so Firm A has more reason to give ground. Both lose from delay, but unequally, and that difference decides the balance.',
  }),
  bankItem({
    slug: 'take-it-or-leave-it',
    facet: 'bargaining',
    b: 0.9,
    context: `Ren proposes how to split 10 points with Sol, in whole points. Sol either accepts, and both get the split, or rejects, and both get 0. Sol rejects any offer that gives him 0 and accepts any other. ${RATIONAL}`,
    question: 'Which proposal gives Ren the most points?',
    options: ['Ren 5, Sol 5', 'Ren 10, Sol 0', 'Ren 7, Sol 3', 'Ren 9, Sol 1'],
    key: 3,
    rationale:
      'Sol accepts any offer that gives him at least 1 point, so offering 1 leaves Ren 9. Offering nothing would be rejected and leave Ren with 0; offering more than 1 only costs Ren points.',
  }),
  bankItem({
    slug: 'shrinking-pot',
    facet: 'bargaining',
    b: 2.6,
    context: `Kim and Lou must split 10 points. Kim proposes a split first. If Lou rejects it, the pot shrinks to 6 points, Lou proposes a split of those 6, and Kim can only accept or reject; if Kim rejects, both get 0. Anyone offered exactly what rejecting would give them accepts. ${RATIONAL}`,
    question: 'What should Kim propose?',
    options: ['Kim 5, Lou 5', 'Kim 4, Lou 6', 'Kim 6, Lou 4', 'Kim 10, Lou 0'],
    key: 1,
    rationale:
      'If Lou rejects, he can offer Kim 0 of the 6 and Kim will accept, so Lou can count on 6 by rejecting. Kim must therefore give Lou 6 and keeps 4; any smaller offer to Lou is rejected and leaves Kim with nothing.',
  }),
];

export const strategic = bankParadigm<BankContent>({
  id: 'strategic',
  version: 1,
  domain: 'strategic',
  group: 'core',
  title: 'Strategic scenarios',
  subtitle: 'Find the best move when others are thinking too.',
  construct:
    'Reasoning about choices whose outcome depends on what others choose: responding, committing, signalling, coordinating, bidding and bargaining.',
  instructions: [
    'Each scenario states the choices and what everyone gains.',
    'Assume everyone wants the most points and knows the others do too, unless told otherwise.',
    'Choose the option that is best under the stated rules.',
  ],
  minutes: 8,
  minRtMs: 4000,
  items: strategicItems,
  facetTargets: {
    'best-response': 0.15,
    commitment: 0.15,
    signalling: 0.14,
    coordination: 0.14,
    'iterated-dominance': 0.14,
    auctions: 0.14,
    bargaining: 0.14,
  },
  defaultA: 1.4,
  defaultTimeLimitMs: 90_000,
});
