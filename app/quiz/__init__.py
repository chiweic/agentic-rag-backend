"""Quiz module — LLM-generated multiple-choice quizzes over a single source."""

from __future__ import annotations

from app.quiz.generate import Quiz, QuizOption, QuizQuestion, generate_quiz

__all__ = ["Quiz", "QuizOption", "QuizQuestion", "generate_quiz"]
