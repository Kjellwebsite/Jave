import type { DomainId } from '../types';

export interface DomainInfo {
  id: DomainId;
  index: number;
  name: string;
  short: string;
  anchor: string;
  /** How the domain is scored in this version. */
  status: 'core' | 'performance' | 'metrics' | 'experimental';
}

export const DOMAINS: DomainInfo[] = [
  { id: 'reasoning', index: 1, name: 'Reasoning', short: 'Induction, deduction and analogy with novel material.', anchor: 'Gf', status: 'core' },
  { id: 'quant', index: 2, name: 'Quantitative & Probabilistic', short: 'Relations between quantities and reasoning under uncertainty.', anchor: 'Gf-RQ · Gq', status: 'core' },
  { id: 'memory', index: 3, name: 'Memory', short: 'Holding, manipulating and retaining information.', anchor: 'Gwm · Gl', status: 'core' },
  { id: 'attention', index: 4, name: 'Attention & Processing', short: 'Speed, search, vigilance and dual-task control.', anchor: 'Gs', status: 'performance' },
  { id: 'executive', index: 5, name: 'Executive Function', short: 'Planning, shifting and interference control.', anchor: 'Shifting · inhibition · planning', status: 'core' },
  { id: 'learning', index: 6, name: 'Learning', short: 'Acquiring rules from feedback and transferring them.', anchor: 'Gl · concept learning', status: 'core' },
  { id: 'strategic', index: 7, name: 'Strategic', short: 'Look-ahead and incentives in multi-agent situations.', anchor: 'Gf applied to games', status: 'core' },
  { id: 'metacognition', index: 8, name: 'Metacognition', short: 'How well your confidence tracks your accuracy.', anchor: 'Confidence–accuracy', status: 'metrics' },
  { id: 'social', index: 9, name: 'Social Cognition', short: 'Beliefs, intentions and incentives of other people.', anchor: 'Theory of mind', status: 'core' },
  { id: 'language', index: 10, name: 'Language', short: 'Verbal reasoning, semantic knowledge and linguistic induction.', anchor: 'Gc · verbal Gf', status: 'core' },
  { id: 'natural', index: 11, name: 'Adaptive / Natural', short: 'Orientation and pattern anomalies in natural settings.', anchor: 'Experimental JVLN construct', status: 'experimental' },
];

export const domainInfo = (id: DomainId) => DOMAINS.find((d) => d.id === id)!;
