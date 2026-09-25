import { countCorrect, countTag, runQuiz, type QuizItem } from '../core/quiz';
import type { TaskDef } from '../core/types';

/** Original short stories. The first option listed is the correct one; options are shuffled on screen. */
const STORIES: QuizItem[] = [
  {
    tag: 'Theory of Mind',
    context:
      'Maya puts her keys in the blue bowl by the door and goes for a run. While she is out, her roommate Leo moves the keys into a drawer so the cat cannot knock them off. Maya comes home and wants her keys.',
    question: 'Where will Maya look first?',
    options: ['In the blue bowl', 'In the drawer', 'On the floor near the cat', "In Leo's room"],
    answer: 0,
  },
  {
    tag: 'Intent Recognition',
    context:
      'It has rained every single day of Sam’s beach holiday. When a friend calls to ask how it is going, Sam says: “Oh, it’s perfect. I’ve got a fantastic tan.”',
    question: 'What does Sam mean?',
    options: ['He is disappointed with the holiday', 'He is enjoying the holiday', 'He got sunburnt', 'He wants to stay longer'],
    answer: 0,
  },
  {
    tag: 'Emotion Understanding',
    context:
      'Aiden and his best friend both auditioned for the lead in the school play. The friend got the part. When the list goes up, Aiden hugs him and says, “You totally deserve it!” That evening he skips the celebration dinner, saying he has homework.',
    question: 'What is Aiden most likely feeling?',
    options: ['Disappointed, and hiding it', 'Happy and relaxed', 'Angry at the teacher', 'Indifferent'],
    answer: 0,
  },
  {
    tag: 'Social Inference',
    context:
      'In a meeting, the manager says, “It’s quite warm in here, isn’t it?” while looking at the intern who is sitting next to the closed window.',
    question: 'What does the manager most likely want?',
    options: ['The intern to open the window', 'To make small talk about the weather', 'To end the meeting early', 'The intern to leave the room'],
    answer: 0,
  },
  {
    tag: 'Perspective Taking',
    context:
      'Ben and Chloe see the ice-cream van in the park. Ben runs home to get money. While he is gone, the driver tells Chloe he is moving to the school gate. On his way back, Ben passes the school and sees the van there. Chloe does not know that Ben saw it.',
    question: 'Where does Chloe think Ben will go to find the van?',
    options: ['To the park', 'To the school gate', 'Back home', 'Chloe thinks Ben will call her first'],
    answer: 0,
  },
  {
    tag: 'Intent Recognition',
    context:
      'Ella has hidden a surprise birthday present for Tom in the garage. Tom’s brother Max knows about it. At dinner, Tom announces that he will clear out the garage tomorrow. Max quickly says, “I think it’s supposed to rain tomorrow. Let’s do it next weekend.”',
    question: 'Why does Max say this?',
    options: ['To stop Tom from finding the present', 'He checked the weather forecast', 'He does not like cleaning', 'He wants Tom to do it alone'],
    answer: 0,
  },
  {
    tag: 'Social Situation Understanding',
    context:
      'At a dinner party, Priya tells another guest: “Whoever picked these curtains has no taste.” The guest smiles tightly and changes the subject. Later Priya learns that the guest chose the curtains as a housewarming gift for the host.',
    question: 'What went wrong in the conversation?',
    options: [
      'Priya insulted the guest’s choice without realising it',
      'The guest was rude for changing the subject',
      'The host should not have hung the curtains',
      'Nothing, the guest agreed with Priya',
    ],
    answer: 0,
  },
  {
    tag: 'Emotional Reasoning',
    context:
      'After ten years in her hometown, Rosa is leaving for her dream job abroad. At the airport she laughs and jokes with her family while tears run down her face.',
    question: 'What best describes how Rosa feels?',
    options: ['Excited and sad at the same time', 'Only sad about leaving', 'Only happy about the job', 'Afraid of flying'],
    answer: 0,
  },
  {
    tag: 'Social Reasoning',
    context:
      'A salesperson at the door says: “Most people on your street have already switched to us. I’d hate for you to be the only one still paying more.”',
    question: 'What is the salesperson mainly relying on?',
    options: ['Social pressure and fear of missing out', 'Detailed evidence about prices', 'A personal friendship', 'Humour'],
    answer: 0,
  },
  {
    tag: 'Theory of Mind',
    context:
      'During a war, a captured soldier is asked where his army’s tanks are. He knows his captors expect him to lie about it. He answers truthfully: “They are in the mountains.”',
    question: 'Why does he tell the truth?',
    options: [
      'He expects them not to believe him, so they will search elsewhere',
      'He wants to help the enemy',
      'He has forgotten the real plan',
      'He hopes to be released for cooperating',
    ],
    answer: 0,
  },
];

export const minds: TaskDef = {
  id: 'minds',
  domain: 'social',
  name: 'Story Minds',
  tagline: 'Read between the lines.',
  minutes: 4,
  measures: ['Theory of Mind', 'Perspective Taking', 'Intent Recognition', 'Social Inference', 'Emotion Understanding'],
  instructions: [
    'You read ten short everyday stories.',
    'Each one asks what someone thinks, feels or means.',
    'Pick the most likely answer. You have 60 seconds per story.',
  ],
  async run(ctx) {
    const trials = await runQuiz(ctx, STORIES, { timeLimit: 60_000 });
    const correct = countCorrect(trials);
    const tags = ['Theory of Mind', 'Perspective Taking', 'Intent Recognition', 'Social Inference', 'Emotion Understanding', 'Emotional Reasoning', 'Social Situation Understanding', 'Social Reasoning'];
    return {
      score: correct / STORIES.length,
      scoreDisplay: `${correct} of ${STORIES.length} stories read right`,
      facets: tags.map((tag) => ({ facet: tag, display: `${countCorrect(trials, tag)}/${countTag(trials, tag)}` })),
      trials,
    };
  },
};
