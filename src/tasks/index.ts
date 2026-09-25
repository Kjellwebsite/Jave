import type { TaskDef } from '../core/types';
import { aliens } from './aliens';
import { cardsort } from './cardsort';
import { corsi } from './corsi';
import { matrix } from './matrix';
import { minds } from './minds';
import { motion } from './motion';
import { odds } from './odds';
import { rat } from './rat';
import { reaction } from './reaction';
import { signal } from './signal';
import { words } from './words';

/** The JVLN Core battery: one task per domain, in running order. */
export const CORE: TaskDef[] = [matrix, corsi, reaction, cardsort, aliens, odds, rat, signal, minds, words, motion];

export const taskById = (id: string) => CORE.find((t) => t.id === id);
