/**
 * Social inference: authored scenarios on intent, deception, manipulation,
 * incentives, coalitions, emotion understanding and perspective. Every key
 * follows from the stated facts; see docs/TASK_DESIGN.md (Social inference).
 */
import { bankParadigm } from '../paradigm';
import { bankItem, type BankContent, type BankItem } from './content';

export const socialItems: BankItem[] = [
  /* ---------------------------------------------------------------- practice */
  bankItem({
    slug: 'practice-sofa',
    facet: 'intent',
    b: -2,
    practice: true,
    context:
      'Priya sees her neighbour Tomasz struggling to carry a heavy sofa up the stairs on his own. She puts down her shopping bags and lifts the other end.',
    question: 'What is Priya most likely trying to do?',
    options: ['Take the sofa for herself', 'Help Tomasz carry the sofa', 'Stop Tomasz from moving in', 'Test how heavy the sofa is'],
    key: 1,
    rationale:
      'She lifts the other end of a sofa he is struggling with, which is helping. Nothing suggests she wants the sofa or objects to him moving in.',
  }),
  bankItem({
    slug: 'practice-marathon',
    facet: 'emotion-understanding',
    b: -2,
    practice: true,
    context:
      'Jonas trained for a year for his first marathon. He crosses the finish line well inside the time he had hoped for.',
    question: 'What is Jonas most likely to feel?',
    options: ['Shame', 'Boredom', 'Pride', 'Envy'],
    key: 2,
    rationale:
      'Reaching a hard goal through his own long effort is the typical cause of pride. Nothing in the situation involves a failure (shame) or someone else’s success (envy).',
  }),

  /* ------------------------------------------------------------------ intent */
  bankItem({
    slug: 'meeting-clock',
    facet: 'intent',
    b: -1.0,
    context:
      'A team meeting has run 40 minutes over time. Karim keeps glancing at the clock. When the chair asks whether there are any more questions, Karim says at once, ‘I think we’ve covered everything.’',
    question: 'What is Karim most likely trying to achieve?',
    options: [
      'Open a new topic for discussion',
      'Show that he disagrees with the chair',
      'Bring the meeting to a close',
      'Get the chair to repeat the last point',
    ],
    key: 2,
    rationale:
      'Watching the clock in an overrunning meeting and answering the call for questions with ‘we’ve covered everything’ both point to wanting it to end. Nothing he says signals disagreement with the chair.',
  }),
  bankItem({
    slug: 'treasurer-late-list',
    facet: 'intent',
    b: 0.2,
    context:
      'Lena, treasurer of a rowing club, often complains that the same few members pay their fees late. Her reminder to all members says: ‘Fees are due Friday. I’ve attached last year’s list of late payers, just for reference.’',
    question: 'Why did Lena most likely attach the list?',
    options: [
      'To shame the usual late payers into paying on time',
      'To ask members to check last year’s records for mistakes',
      'To show that the club’s finances are in good order',
      'To thank the members who paid on time last year',
    ],
    key: 0,
    rationale:
      'Her repeated complaints about the same late payers, plus a list of their names sent to everyone, point to social pressure. A list of late payers says nothing about the finances being in order, and it names no one who paid on time.',
  }),
  bankItem({
    slug: 'proofread-rival',
    facet: 'intent',
    b: 1.3,
    context:
      'Dmitri and Sara are competing for the same promotion, which the director will decide partly on Sara’s report. Dmitri usually returns reviews within an hour. He took Sara’s report the afternoon before it was due and returned it at 8:55 for a 9:00 deadline, with forty comments on style and none on errors.',
    question: 'Which reading fits all the facts best?',
    options: [
      'He was checking carefully that the report was free of errors',
      'He hoped Sara would then invite him to co-author the report',
      'He wanted the director to see how closely it had been checked',
      'He looked helpful but left her no time to act on the comments',
    ],
    key: 3,
    rationale:
      'His unusual delay, the rivalry, and comments that fixed nothing together suggest a show of help timed so it could not be used. A careful error check fits badly, since none of the forty comments concerned errors.',
  }),
  bankItem({
    slug: 'peach-price-cut',
    facet: 'intent',
    b: 1.6,
    context:
      'Omar sells only peaches at a street market. When a new peach stall opens across the aisle, he prices his peaches below what they cost him, but only while that stall is open. Two weeks later the new stall closes for good, and Omar raises his price above its old level.',
    question: 'What was Omar most likely aiming at when he cut his price?',
    options: [
      'Selling off his stock of peaches before it spoiled',
      'Pushing out the rival so he could charge more',
      'Drawing shoppers towards his other products',
      'Matching a price set by the market organisers',
    ],
    key: 1,
    rationale:
      'The cut lasted exactly as long as the rival stayed open, and his price rose above the old level once it closed. Spoilage cannot explain a two-week cut timed to the rival, and he sells no other products.',
  }),
  bankItem({
    slug: 'friday-training-vote',
    facet: 'intent',
    b: 1.9,
    context:
      'In a football club’s group chat, Joel proposes a vote on dropping Friday training and adds: ‘Coach says she’ll go with whatever the group decides.’ Joel has missed every Friday session this season, and the coach has told him privately that one more absence will cost him his place.',
    question: 'Why does Joel most likely mention the coach’s position?',
    options: [
      'To make the vote decisive and so escape the coach’s threat',
      'To show that the coach wants to keep Friday training',
      'To warn teammates that absences may cost them their places',
      'To let the coach see how the rest of the group feels',
    ],
    key: 0,
    rationale:
      'If Friday training is dropped, Joel cannot miss it, and the coach’s promise makes the vote decisive. Nothing suggests she wants to keep Friday training, and the warning about absences was made privately to Joel only.',
  }),

  /* --------------------------------------------------------------- deception */
  bankItem({
    slug: 'proposal-already-sent',
    facet: 'deception',
    b: -0.6,
    context:
      'At 10:00 Marta tells her team she has ‘already sent’ the client proposal. At 10:10 a colleague sees her screen: a nearly blank document titled ‘Client proposal – draft 1’.',
    question: 'Which conclusion is best supported?',
    options: [
      'The client has asked for a second version',
      'The colleague was looking at the wrong screen',
      'Marta sent the proposal and is now writing notes',
      'The proposal had not been sent when she said so',
    ],
    key: 3,
    rationale:
      'A nearly blank first draft ten minutes later means no finished proposal existed at 10:00. A request for a second version would not produce a document titled ‘draft 1’.',
  }),
  bankItem({
    slug: 'two-excuses',
    facet: 'deception',
    b: 0.3,
    context:
      'Asked why he missed Saturday’s practice, Felix tells the coach he set off by car and it broke down on the motorway. Later he tells a teammate that he cycled from home and gave up after a puncture halfway. Both stories are about the same Saturday.',
    question: 'What can reasonably be concluded?',
    options: [
      'He lied to the teammate but not to the coach',
      'At least one of his two accounts is untrue',
      'Both accounts could be true of the same trip',
      'The teammate must have misheard the story',
    ],
    key: 1,
    rationale:
      'He cannot have set off both by car and by bike from home on the same trip, so at least one account is false. The facts do not reveal which one, so blaming the teammate’s version goes beyond the evidence.',
  }),
  bankItem({
    slug: 'honest-bettor',
    facet: 'deception',
    b: 1.0,
    context:
      'In a weekly card game at the community centre, Ines is known never to bluff: when she bets big, she has always held a strong hand. Tonight, holding a weak hand, she bets big for the first time in months. Raúl, who knows her record, folds.',
    question: 'Why did Ines’s bet work?',
    options: [
      'Raúl was holding a weaker hand than she was',
      'Ines let Raúl see that she was bluffing',
      'Her honest record made the bluff believable',
      'Raúl wanted to lose to keep the game friendly',
    ],
    key: 2,
    rationale:
      'Raúl folded because a big bet from Ines had always meant a strong hand, so her reputation carried the bluff. Nothing tells us Raúl’s hand, so claiming it was weaker than hers is unsupported.',
  }),
  bankItem({
    slug: 'moderator-claim',
    facet: 'deception',
    b: 1.7,
    context:
      'Yusuf, a moderator of an online gardening forum, posts: ‘Someone has been using fake accounts to upvote their own seed shop. I know who it is. If the accounts are deleted by Sunday, I won’t name anyone.’ In fact, Yusuf only knows that the accounts were created in a town where three regular members live.',
    question: 'What is Yusuf doing when he writes ‘I know who it is’?',
    options: [
      'Bluffing, so that the culprit fears being named',
      'Reporting what his checks have already confirmed',
      'Accusing the three members from that town',
      'Asking members to help him find the culprit',
    ],
    key: 0,
    rationale:
      'He claims a certainty he does not have, and his offer not to name anyone only works if the culprit believes exposure is certain. He knows only a town shared by three members, so he has confirmed nothing.',
  }),
  bankItem({
    slug: 'distrusted-messenger',
    facet: 'deception',
    b: 3.1,
    context:
      'Two bakers, Kessler and Moreau, are rivals. Moreau never bids for a market pitch if Kessler is bidding. Kessler is not bidding for the new station pitch, but he wants Moreau not to get it. Moreau knows Kessler has twice used a mutual friend to spread false stories, and Kessler knows Moreau knows this. Kessler tells that friend: ‘I’m not bidding for the station pitch.’',
    question: 'Why does Kessler pass on this true statement through that friend?',
    options: [
      'He wants to warn Moreau honestly that the pitch is free',
      'He is testing whether the friend repeats what he hears',
      'He wants Moreau to believe that he is not bidding',
      'He expects Moreau to disbelieve it and stay away',
    ],
    key: 3,
    rationale:
      'Moreau distrusts messages from this source, so a true ‘not bidding’ will likely be read as ‘bidding’, which keeps Moreau away. If Kessler wanted his words believed, he would not choose a source Moreau distrusts.',
  }),

  /* ------------------------------------------------------------ manipulation */
  bankItem({
    slug: 'ten-minute-upgrade',
    facet: 'manipulation',
    b: -0.8,
    context:
      'A caller tells Rosa that her ‘free upgrade’ expires in ten minutes and she must give her card number now to keep it. When she asks to call back later, the caller says the offer will be gone by then.',
    question: 'Which tactic is the caller mainly using?',
    options: [
      'Offering a recommendation from a friend',
      'Rushing her so she decides before checking',
      'Appealing to her sense of family duty',
      'Giving her detailed written terms to compare',
    ],
    key: 1,
    rationale:
      'The ten-minute deadline and the refusal of a call-back are designed to stop her checking. The caller mentions no friend, no family and no written terms.',
  }),
  bankItem({
    slug: 'petition-to-host',
    facet: 'manipulation',
    b: 0.6,
    context:
      'A neighbour asks Pavel to sign a petition for a new pedestrian crossing. A week later she asks him to join the campaign committee. Two weeks after that she asks him to host the committee every month.',
    question: 'Which approach does this sequence of requests best show?',
    options: [
      'An extreme first request that makes later ones look modest',
      'A favour done first so that he feels he owes her one',
      'A claim that most neighbours have already agreed',
      'Small steps that make each bigger request seem natural',
    ],
    key: 3,
    rationale:
      'Each request builds on one he has already accepted, starting small. The ‘extreme first request’ pattern is the reverse: it starts large and retreats, which is not what happens here.',
  }),
  bankItem({
    slug: 'weekend-shift-favour',
    facet: 'manipulation',
    b: 0.9,
    context:
      'Before asking Nadia to cover a weekend shift, her manager Elif says: ‘You know how hard I fought to get you onto this team when others doubted you.’',
    question: 'What is the main purpose of Elif’s opening remark?',
    options: [
      'To warn Nadia that her job may be at risk',
      'To praise Nadia’s recent work on the team',
      'To make refusing feel like ingratitude',
      'To explain why the weekend shift matters',
    ],
    key: 2,
    rationale:
      'Reminding Nadia of a past favour just before a request makes refusing feel ungrateful. The remark mentions no current threat to her job and nothing about the shift itself.',
  }),
  bankItem({
    slug: 'honey-middle-jar',
    facet: 'manipulation',
    b: 1.6,
    context:
      'A market stall sells honey in two jars: 250 g for 5 euros and 500 g for 10 euros. Most people buy the small jar. The stall-holder adds a 450 g jar for 9.50 euros. Almost nobody buys it, but sales of the 500 g jar double.',
    question: 'Why did the stall-holder most likely add the 450 g jar?',
    options: [
      'To make the 500 g jar look like good value',
      'To use up a surplus stock of 450 g jars',
      'To make the 250 g jar look like good value',
      'To give buyers a genuine middle-sized choice',
    ],
    key: 0,
    rationale:
      'For only 50 cents more, the 500 g jar gives 50 g extra, so it looks like a bargain next to the 450 g jar. The new jar hardly sells, which fits its role as a comparison, and it is the large jar, not the small one, whose sales rose.',
  }),
  bankItem({
    slug: 'loaded-poll',
    facet: 'manipulation',
    b: 1.9,
    context:
      'In a residents’ online group, Colm posts a poll: ‘Should we keep paying 40 euros a month each for the gardener, or let the courtyard become overgrown and unsafe?’ Colm’s firm holds the gardening contract.',
    question: 'Which feature of the poll most directly pushes residents toward one answer?',
    options: [
      'It states the monthly cost for each resident',
      'It describes the only alternative as unsafe',
      'It is posted where every resident can see it',
      'It lists the option of keeping the gardener first',
    ],
    key: 1,
    rationale:
      'Offering one alternative and describing it as overgrown and unsafe loads the choice. Stating the cost, if anything, pushes the other way, and the order of the options is a far weaker influence than loaded wording.',
  }),

  /* -------------------------------------------------------------- incentives */
  bankItem({
    slug: 'warranty-bonus',
    facet: 'incentives',
    b: -1.3,
    context:
      'A shop assistant earns a bonus for every extended warranty she sells. She recommends the warranty to every customer who buys a toaster, whatever the model.',
    question: 'Which fact best explains her recommendation?',
    options: [
      'Toasters break more often than other goods',
      'Customers have asked her for warranties',
      'She is paid more when a customer buys one',
      'The shop does not sell toasters without one',
    ],
    key: 2,
    rationale:
      'The bonus gives her a reason to recommend the warranty whatever the product. The scenario says nothing about toasters breaking or customers asking.',
  }),
  bankItem({
    slug: 'kit-supplier',
    facet: 'incentives',
    b: 0.2,
    context:
      'A sports club’s committee must choose a kit supplier. Committee member Aoife argues hard for Supplier B, citing its low price. It later emerges that this price is available only through a sales agent who is Aoife’s sister-in-law and earns commission on the order. Aoife never mentioned this.',
    question: 'What is the clearest problem with Aoife’s conduct?',
    options: [
      'She should not have taken price into account',
      'Supplier B’s price was not really the lowest',
      'She should have argued for a costlier supplier',
      'She kept quiet about a family interest in the deal',
    ],
    key: 3,
    rationale:
      'A relative earning commission gave her a stake in the decision, and she did not disclose it. Nothing suggests the price claim was false, so that option goes beyond the facts.',
  }),
  bankItem({
    slug: 'agent-quick-sale',
    facet: 'incentives',
    b: 1.1,
    context:
      'An estate agent urges a seller to accept an offer of 300,000 now rather than wait a few weeks for a possible 310,000; if they wait, the current buyer may withdraw. The agent’s fee is 1% of the sale price and is paid only if a sale completes.',
    question: 'Why might the agent prefer the quick sale?',
    options: [
      'Waiting would add only 100 to her fee but risk all of it',
      'Her fee would shrink if the house sold for a higher price',
      'The law obliges agents to accept the first reasonable offer',
      'A lower price gives her a larger percentage fee',
    ],
    key: 0,
    rationale:
      '1% of the extra 10,000 is only 100, while a failed sale would cost her the whole 3,000 fee. Her fee rises with the price, so the options claiming it falls are false.',
  }),
  bankItem({
    slug: 'trial-match-pitch',
    facet: 'incentives',
    b: 1.5,
    context:
      'Club coaches are rewarded when their own training group supplies the most players for the regional team. Coach Petra proposes that selection be based on a single trial match on the Tuesday pitch. Her group is the only one that trains on that pitch every week.',
    question: 'What best explains Petra’s proposal?',
    options: [
      'The Tuesday pitch is the only one available',
      'A single match is the fairest test of ability',
      'Familiar ground would favour her own players',
      'She wants an independent panel to choose',
    ],
    key: 2,
    rationale:
      'Her players know the Tuesday pitch, which would help them in the trial, and she is rewarded when her group supplies the most players. Nothing says the pitch is the only one available, and a panel is not what she proposed.',
  }),
  bankItem({
    slug: 'support-ratings',
    facet: 'incentives',
    b: 2.2,
    context:
      'A company pays support agents a bonus based on customers’ average rating. A rating is requested only when an agent marks a chat ‘resolved’; agents can instead transfer a chat to another department, and then no rating is requested. After the bonus starts, average ratings rise sharply, and so do complaints to head office.',
    question: 'Which explanation fits both changes?',
    options: [
      'Customers became happier, so they had more time to complain',
      'Agents pass difficult chats on, so unhappy customers go unrated',
      'Agents became friendlier, which improved service across the board',
      'Head office made it easier for customers to send complaints',
    ],
    key: 1,
    rationale:
      'Transferring hard chats removes unhappy customers from the ratings, which raises the average, while those customers complain elsewhere. Better service alone would not raise complaints, and nothing says head office changed its process.',
  }),

  /* -------------------------------------------------------------- coalitions */
  bankItem({
    slug: 'sunday-street',
    facet: 'coalitions',
    b: -0.4,
    context:
      'A neighbourhood votes on closing a street to cars on Sundays. Café owners vote yes because they want more outdoor customers; the parents’ group votes yes because they want safe space for children to play. Delivery drivers vote no.',
    question: 'Why did the café owners and the parents vote the same way?',
    options: [
      'The same outcome serves their different interests',
      'They both want outdoor customers for their cafés',
      'The parents’ group runs most of the cafés',
      'They agreed to oppose the drivers on every issue',
    ],
    key: 0,
    rationale:
      'Each group wants the closure for its own reason, and one outcome serves both. Their reasons are stated to differ, and no wider agreement is mentioned.',
  }),
  bankItem({
    slug: 'chess-venue',
    facet: 'coalitions',
    b: 0.4,
    context:
      'A chess club of 30 members votes on a new venue, and the option with the most votes wins. 12 members want the library, 10 the school hall and 8 the café. The café group tells the school-hall group: ‘We’ll switch our 8 votes to you if club night moves to Friday.’',
    question: 'Why does the school-hall group have a reason to accept?',
    options: [
      'Without the deal, the café would win the vote',
      'The library group has already withdrawn',
      'Friday is the only night the hall is free',
      'With 18 votes they would beat the library’s 12',
    ],
    key: 3,
    rationale:
      'Alone they lose 10 to 12 to the library; with the café’s 8 votes they have 18 and win. The café group, with 8, was in last place and could not win without a deal.',
  }),
  bankItem({
    slug: 'board-swing-vote',
    facet: 'coalitions',
    b: 1.4,
    context:
      'A five-person housing board decides by 3 votes. Ade and Bea always vote together, Cai and Dee always vote together, and Eli has no fixed side, so both pairs court Eli. On a new issue, Cai breaks with Dee and sides with Ade and Bea.',
    question: 'On this issue, what happens to Eli’s influence?',
    options: [
      'It rises, because both sides now need him',
      'It falls, because three members agree without him',
      'It is unchanged, because he still has one vote',
      'It rises, because Dee must now win him over',
    ],
    key: 1,
    rationale:
      'Ade, Bea and Cai already have the three votes needed, so Eli’s vote no longer decides the outcome. Dee and Eli together make only two, so winning Eli over cannot help Dee.',
  }),
  bankItem({
    slug: 'weighted-garden-vote',
    facet: 'coalitions',
    b: 2.0,
    context:
      'A community garden committee has three groups with 45, 35 and 20 votes. A decision passes with more than 50 votes, and each group always votes as a block.',
    question: 'Which statement about the groups’ power is correct?',
    options: [
      'The 45-vote group can pass decisions without anyone else',
      'The 20-vote group can never change the outcome of a vote',
      'Each pair can pass a decision, so all three are equally needed',
      'Only the 45- and 35-vote groups together can pass one',
    ],
    key: 2,
    rationale:
      '45+35, 45+20 and 35+20 all exceed 50, and no group has more than 50 alone, so every pair can win and no group is more decisive than another. The 20-vote group is part of two of the three winning pairs, so it is far from powerless.',
  }),
  bankItem({
    slug: 'pitch-hours-split',
    facet: 'coalitions',
    b: 2.4,
    context:
      'Three clubs, Harbour, Hill and Park, must share 90 hours of pitch time. Any split agreed by two of the clubs is final, and the third gets what is left, possibly nothing. Harbour and Hill propose 45 hours each, leaving Park none. Everyone wants to maximise their own hours and knows the others do too.',
    question: 'What can Park do that most threatens this proposal?',
    options: [
      'Offer Hill 50 hours and keep 40, leaving Harbour none',
      'Offer Harbour and Hill 30 hours each, keeping 30',
      'Refuse to sign anything until all three clubs agree',
      'Ask the league to add a fourth club to the talks',
    ],
    key: 0,
    rationale:
      'Hill would gain 5 hours and Park 40 compared with the current deal, so both prefer it, and together they can make it final. Offering 30 each fails because Harbour and Hill already get 45 each, and a refusal has no force when two clubs suffice.',
  }),

  /* --------------------------------------------------- emotion understanding */
  bankItem({
    slug: 'stolen-credit',
    facet: 'emotion-understanding',
    b: -1.2,
    context:
      'Mei spent a month developing a plan on her own. In a meeting, a colleague presents the plan as his own idea, and the director praises him.',
    question: 'What is Mei most likely to feel?',
    options: [
      'Embarrassment at a mistake she made',
      'Gratitude that the plan was praised',
      'Guilt about not presenting it herself',
      'Anger at being treated unfairly',
    ],
    key: 3,
    rationale:
      'Someone else took credit for her work, a wrong done to her by another person, which typically produces anger. She made no mistake and did nothing wrong, so embarrassment and guilt do not fit.',
  }),
  bankItem({
    slug: 'one-point-short',
    facet: 'emotion-understanding',
    b: 0.3,
    context:
      'Tobias badly wanted a scholarship, though he thought his chances were slim. He learns he came second, missing it by a single point.',
    question: 'Which feeling best fits his situation, and why?',
    options: [
      'Indifference, since he expected to lose anyway',
      'Frustration, since he came very close to winning',
      'Relief, since he no longer has to move abroad',
      'Shame, since he was ranked last among the applicants',
    ],
    key: 1,
    rationale:
      'Missing by one point makes winning feel as if it was within reach, so the loss stings more than an expected defeat. His low expectation does not remove how much he wanted it, and he was second, not last.',
  }),
  bankItem({
    slug: 'coach-clipboard',
    facet: 'emotion-understanding',
    b: 0.9,
    context:
      'A team loses when a player misses a late penalty. The coach tells the player, ‘Don’t worry, it happens to everyone,’ and pats his back. Minutes later, alone in the changing room, the coach slams his clipboard onto the table.',
    question: 'What does the scene best show about the coach?',
    options: [
      'He was frustrated but showed the player only support',
      'He felt no disappointment about losing the match',
      'He blamed the player and wanted him to know it',
      'He was pleased that the long match was finally over',
    ],
    key: 0,
    rationale:
      'Slamming the clipboard when alone shows frustration that he kept from the player. He showed the player no blame, so ‘wanted him to know it’ contradicts what he actually said.',
  }),
  bankItem({
    slug: 'borrowed-ladder',
    facet: 'emotion-understanding',
    b: 1.6,
    context:
      'Kofi borrows his neighbour’s ladder without asking, meaning to return it within the hour. While he is indoors, it is stolen from his garden. Nobody saw him take it. Later the neighbour, searching for the ladder, asks Kofi whether he has seen it.',
    question: 'Which emotion is Kofi most likely to feel as he is asked, and why?',
    options: [
      'Embarrassment, because others saw him using it',
      'Anger, because his neighbour suspects him',
      'Guilt, because his own action caused the loss',
      'Pride, because he meant to return it quickly',
    ],
    key: 2,
    rationale:
      'Kofi knows privately that his unapproved borrowing led to the theft, the typical situation for guilt. Nobody saw him, so embarrassment at being seen does not fit, and nothing suggests the neighbour suspects him.',
  }),
  bankItem({
    slug: 'failed-business',
    facet: 'emotion-understanding',
    b: 1.3,
    context:
      'Anika decided not to invest in a friend’s new business and advised the friend not to put her savings into it. The friend invested anyway. A year later the business fails and the friend loses her savings.',
    question: 'Which pair of feelings best fits Anika’s situation?',
    options: [
      'Guilt for causing the loss, and pride in her own advice',
      'Regret at not investing, and envy of her friend',
      'Shame about her advice, and anger at herself',
      'Relief for her own money, and sadness for her friend',
    ],
    key: 3,
    rationale:
      'Her own money is safe, which fits relief, and her friend has suffered a loss, which fits sadness. She did not cause the loss and her advice proved sound, so guilt, regret and shame have no basis.',
  }),
  bankItem({
    slug: 'decisive-recommendation',
    facet: 'emotion-understanding',
    b: 2.1,
    context:
      'Amir trained his junior colleague Ruth. When asked for his opinion, he recommended her to lead a new project, believing he was not a candidate himself. He later learns he was the other candidate, and that his recommendation decided it in Ruth’s favour.',
    question: 'Which combination of feelings best fits Amir’s situation?',
    options: [
      'Resentment of Ruth for hiding that he was a candidate',
      'Pride in Ruth, mixed with regret about his own advice',
      'Pure satisfaction, since his judgement of Ruth was confirmed',
      'Guilt towards Ruth, since she was chosen over him',
    ],
    key: 1,
    rationale:
      'Ruth’s success reflects his training, which fits pride, while his own words cost him a role he did not know he could get, which fits regret. Nothing says Ruth hid anything, and he has done nothing to her that would call for guilt.',
  }),

  /* ------------------------------------------------------------- perspective */
  bankItem({
    slug: 'cake-in-fridge',
    facet: 'perspective',
    b: -1.4,
    context:
      'Olga puts a cake in the fridge and goes out. While she is away, her flatmate Ben eats the cake and leaves the empty plate in the sink. Olga comes home wanting a slice.',
    question: 'Where will Olga look for the cake first?',
    options: ['In the fridge', 'In the sink', 'In Ben’s room', 'In the shop'],
    key: 0,
    rationale:
      'Olga last saw the cake in the fridge and did not see Ben eat it, so she still believes it is there. The sink is where the plate actually is, which only Ben knows.',
  }),
  bankItem({
    slug: 'mailing-list',
    facet: 'perspective',
    b: -0.2,
    context:
      'Keiko emails everyone on the team list to say the 3 pm meeting has moved to 4 pm. Dan joined the team yesterday and has not been added to the list yet. At 3 pm, Dan’s manager, who got the email, sees Dan waiting in the meeting room.',
    question: 'What should the manager conclude?',
    options: [
      'Dan is choosing to ignore the new time',
      'Keiko sent the change only to Dan',
      'Dan probably never received the change',
      'The meeting has moved back to 3 pm',
    ],
    key: 2,
    rationale:
      'Dan is not on the list the email went to, so he would not know of the change. There is no sign he is ignoring it, and the manager’s own email shows the meeting is at 4 pm.',
  }),
  bankItem({
    slug: 'phone-history',
    facet: 'perspective',
    b: 0.8,
    context:
      'At a market, Sam sells second-hand phones. Yesterday he bought one from a stranger who said nothing about its history, and Sam has not opened it. A customer asks whether it has ever been repaired. Sam says, ‘No, never.’',
    question: 'What could Sam actually know about the phone’s repair history?',
    options: [
      'That it has never been opened or repaired',
      'That the stranger lied to him about it',
      'That the customer already knows its history',
      'Only that the stranger mentioned no repairs',
    ],
    key: 3,
    rationale:
      'Sam’s only source is a stranger who said nothing, and he has not opened the phone, so he cannot know it was never repaired. Nothing indicates that the stranger lied.',
  }),
  bankItem({
    slug: 'watcher-count',
    facet: 'perspective',
    b: 1.9,
    context:
      'On an auction site, sellers can see how many people are watching an item; buyers cannot. Farah is watching a lamp that has no bids yet. The seller, Gil, sees exactly one watcher and posts: ‘Lots of interest in this lamp, bid soon!’',
    question: 'From Farah’s point of view, which conclusion is justified?',
    options: [
      'Gil is lying about the interest in the lamp',
      'She cannot tell whether Gil’s claim is true',
      'Several other people are watching the lamp',
      'Nobody else is going to bid on the lamp',
    ],
    key: 1,
    rationale:
      'Farah cannot see the watcher count, so she has no way to check Gil’s claim. We know it is false, but that knowledge is not available to her, which is the trap in the first option.',
  }),
  bankItem({
    slug: 'match-moved',
    facet: 'perspective',
    b: 2.0,
    context:
      'A captain tells Ana privately that Sunday’s match has moved to Saturday. He tells Bruno the same and adds that Ana has also been told. Chidi is told nothing. Bruno then tells Chidi: ‘There’s a change to Sunday’s match, but Ana doesn’t know about it yet.’ Chidi believes him.',
    question: 'Who now holds a false belief about what someone else knows?',
    options: ['Ana', 'Bruno', 'The captain', 'Chidi'],
    key: 3,
    rationale:
      'Chidi now believes Ana has not heard of the change, but she has. Bruno knows Ana was told, so his statement is a lie rather than a false belief.',
  }),
  bankItem({
    slug: 'sealed-bonus',
    facet: 'perspective',
    b: 2.9,
    context:
      'Rui and Sana each get a sealed note saying whether their own bonus is ‘high’ or ‘low’; neither sees the other’s note. Their manager tells them both, truthfully: ‘At least one of you got a high bonus.’ Sana’s note says ‘high’.',
    question: 'What can Sana conclude about what Rui knows?',
    options: [
      'Rui knows that her bonus is high',
      'Rui does not know what her bonus is',
      'She cannot tell whether Rui knows her result',
      'Rui must have received a low bonus himself',
    ],
    key: 2,
    rationale:
      'If Rui got ‘low’, the announcement tells him Sana’s is high; if he got ‘high’, it tells him nothing about hers. Sana does not know Rui’s note, so she cannot tell which case holds.',
  }),
];

export const social = bankParadigm<BankContent>({
  id: 'social',
  version: 1,
  domain: 'social',
  group: 'core',
  title: 'Social inference',
  subtitle: 'Read the situation. Infer what is really going on.',
  construct:
    'Inferring intentions, deception, pressure tactics, incentives, alliances, emotions and what others know from described situations.',
  instructions: [
    'Each scenario describes what people say, do and know.',
    'Choose the answer that follows best from the stated facts, not from what you would do yourself.',
    'There is one best answer for each scenario.',
  ],
  minutes: 8,
  minRtMs: 4000,
  items: socialItems,
  facetTargets: {
    intent: 0.14,
    deception: 0.14,
    manipulation: 0.14,
    incentives: 0.14,
    coalitions: 0.14,
    'emotion-understanding': 0.15,
    perspective: 0.15,
  },
  defaultA: 1.4,
  defaultTimeLimitMs: 90_000,
});
