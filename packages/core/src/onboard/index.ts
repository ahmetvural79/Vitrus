// src/onboard/index.ts — Onboarding / Day-One barrel (cloud-api + dış tüketiciler).
export { buildCurriculum, renderCurriculum, type Curriculum, type CurriculumStep } from "./curriculum.js";
export { generateQuiz, gradeAnswer, type QuizQuestion, type GradeResult } from "./quiz.js";
