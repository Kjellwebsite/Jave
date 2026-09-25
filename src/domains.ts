import type { Domain, DomainId } from './core/types';

export const DOMAINS: Domain[] = [
  {
    id: 'reasoning',
    name: 'Reasoning',
    facets: [
      'Fluid Reasoning', 'Quantitative Reasoning', 'Spatial Intelligence', 'Abstract Reasoning',
      'Pattern Detection', 'Probabilistic Reasoning', 'Verbal Reasoning', 'Inductive Reasoning',
      'Deductive Reasoning', 'Analogical Reasoning', 'Crystallized Knowledge',
    ],
  },
  {
    id: 'memory',
    name: 'Memory',
    facets: [
      'Working Memory', 'Visual Working Memory', 'Spatial Working Memory', 'Verbal Working Memory',
      'Operation Span', 'Updating', 'Episodic Memory', 'Semantic Memory', 'Recognition Memory',
      'Free Recall', 'Associative Memory', 'Prospective Memory',
    ],
  },
  {
    id: 'speed',
    name: 'Speed & Attention',
    facets: [
      'Processing Speed', 'Simple Reaction Time', 'Choice Reaction Time', 'Sustained Attention',
      'Selective Attention', 'Divided Attention', 'Continuous Attention', 'Visual Search',
      'Attentional Blink', 'Alerting', 'Orienting', 'Response Inhibition', 'Response Consistency',
    ],
  },
  {
    id: 'executive',
    name: 'Executive Function',
    facets: [
      'Cognitive Flexibility', 'Task Switching', 'Rule Switching', 'Set Shifting', 'Inhibitory Control',
      'Impulse Control', 'Planning', 'Sequencing', 'Goal Maintenance', 'Conflict Resolution',
      'Error Monitoring', 'Strategy Selection', 'Strategy Switching',
    ],
  },
  {
    id: 'learning',
    name: 'Learning',
    facets: [
      'Learning Ability', 'Rule Learning', 'Statistical Learning', 'Pattern Learning',
      'Associative Learning', 'Learning Rate', 'Error-Based Learning', 'Transfer Learning',
      'Generalization', 'Concept Formation', 'Learning Efficiency', 'Retention', 'Delayed Recall',
      'Adaptation to Feedback',
    ],
  },
  {
    id: 'decision',
    name: 'Decision Making',
    facets: [
      'Decision Making', 'Risk Assessment', 'Risk Taking', 'Ambiguity Tolerance',
      'Expected Value Reasoning', 'Probability Weighting', 'Cost-Benefit Reasoning',
      'Intertemporal Choice', 'Loss Aversion', 'Strategic Decision Making',
      'Decision Under Time Pressure', 'Decision Under Incomplete Information', 'Calibration',
    ],
  },
  {
    id: 'creativity',
    name: 'Creativity',
    facets: [
      'Divergent Thinking', 'Creative Fluency', 'Creative Flexibility', 'Originality', 'Elaboration',
      'Novelty', 'Conceptual Combination', 'Remote Associations', 'Alternative Uses',
      'Creative Problem Solving', 'Constrained Creativity',
    ],
  },
  {
    id: 'metacognition',
    name: 'Metacognition',
    facets: [
      'Metacognitive Accuracy', 'Confidence Calibration', 'Error Awareness', 'Self-Monitoring',
      'Knowledge Awareness', 'Uncertainty Recognition', 'Strategic Self-Monitoring',
    ],
  },
  {
    id: 'social',
    name: 'Social & Emotional',
    facets: [
      'Emotion Recognition', 'Emotion Understanding', 'Emotion Perception', 'Emotion Regulation',
      'Emotional Reasoning', 'Theory of Mind', 'Perspective Taking', 'Social Inference',
      'Intent Recognition', 'Social Situation Understanding', 'Nonverbal Cue Recognition', 'Empathy',
      'Social Reasoning',
    ],
  },
  {
    id: 'language',
    name: 'Language',
    facets: [
      'Verbal Reasoning', 'Vocabulary', 'Reading Comprehension', 'Verbal Analogies', 'Semantic Fluency',
      'Verbal Fluency', 'Verbal Working Memory', 'Conceptual Knowledge', 'Linguistic Pattern Recognition',
    ],
  },
  {
    id: 'perception',
    name: 'Perception',
    facets: [
      'Visual Discrimination', 'Visual Search', 'Motion Perception', 'Figure-Ground Separation',
      'Temporal Perception', 'Auditory Discrimination', 'Change Detection', 'Visual Attention',
      'Spatial Perception',
    ],
  },
];

export const domainById = (id: DomainId): Domain => DOMAINS.find((d) => d.id === id)!;
