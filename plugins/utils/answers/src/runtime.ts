import { definePluginStore } from 'zhin.js';
import type { QuizService } from './quiz.js';

/** Owner-scoped quiz state consumed by discovered commands and middleware. */
export const quizServiceStore = definePluginStore<QuizService>('zhin.answers.quiz', 'Pending quiz questions per conversation and sender');
export const quizServiceToken = quizServiceStore;
