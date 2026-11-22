"""Parses uploaded question papers (.txt, .csv, .xlsx) into validated v2 `QuestionInput` objects."""
import csv
import io
import re

from app.schemas.exams import QuestionInput, QuestionOption

KIND_ALIASES = {
    "mcq": "mcq_single",
    "mcq_single": "mcq_single",
    "single": "mcq_single",
    "mcq_multi": "mcq_multi",
    "multi": "mcq_multi",
    "multiple": "mcq_multi",
    "true_false": "true_false",
    "tf": "true_false",
    "boolean": "true_false",
    "numeric": "numeric",
    "number": "numeric",
    "short_text": "short_text",
    "short": "short_text",
    "theory": "theory",
    "subjective": "theory",
    "descriptive": "theory",
}


def _build_question(
    *,
    prompt: str,
    raw_kind: str,
    options: list[dict],
    raw_answer: str,
    marks: float,
    negative_marks: float | None,
    explanation: str | None,
) -> QuestionInput | None:
    prompt = prompt.strip()
    if not prompt:
        return None

    kind = KIND_ALIASES.get(raw_kind.strip().lower(), "")
    if not kind:
        kind = "mcq_single" if options else "theory"

    option_models = [QuestionOption(id=opt["id"], text=opt["text"]) for opt in options]
    answer: object = raw_answer.strip()

    if kind == "mcq_single":
        if not option_models:
            return None
        match = re.search(r"[A-Za-z]", str(answer))
        valid_ids = {opt.id for opt in option_models}
        candidate_ans = match.group(0).upper() if match else option_models[0].id
        answer = candidate_ans if candidate_ans in valid_ids else option_models[0].id
    elif kind == "mcq_multi":
        if not option_models:
            return None
        valid_ids = {opt.id for opt in option_models}
        parts = [part.strip().upper() for part in re.split(r"[,;\s]+", str(answer)) if part.strip()]
        chosen = [part for part in parts if part in valid_ids]
        answer = chosen or [option_models[0].id]
    elif kind == "true_false":
        option_models = [QuestionOption(id="T", text="True"), QuestionOption(id="F", text="False")]
        answer = "T" if str(answer).strip().lower() in ("t", "true", "yes", "1") else "F"
    elif kind == "numeric":
        try:
            float(str(answer))
            answer = str(answer).strip()
        except ValueError:
            answer = "0"
    elif kind == "short_text":
        answer = str(answer).strip() or "N/A"
    elif kind == "theory":
        option_models = []
        if answer and not explanation:
            explanation = str(answer)
        answer = None

    return QuestionInput(
        kind=kind,
        prompt=prompt,
        options=option_models,
        correct_answer=answer,
        marks=marks if marks > 0 else 1.0,
        negative_marks=negative_marks,
        explanation=explanation.strip() if explanation else None,
    )


def _parse_text_paper(content: str) -> list[QuestionInput]:
    questions: list[QuestionInput] = []
    for block in re.split(r"\n\s*\n+", content.strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue

        prompt_lines: list[str] = []
        options: list[dict] = []
        raw_kind = ""
        raw_answer = ""
        marks = 1.0
        negative_marks: float | None = None
        explanation = ""

        for line in lines:
            if match := re.match(r"^(?:type|kind|question_type)\s*:\s*(.+)$", line, re.IGNORECASE):
                raw_kind = match.group(1)
            elif match := re.match(r"^(?:marks?|points?)\s*:\s*([\d.]+)$", line, re.IGNORECASE):
                marks = float(match.group(1))
            elif match := re.match(r"^(?:negative(?:\s*marks?)?|penalty)\s*:\s*([\d.]+)$", line, re.IGNORECASE):
                negative_marks = float(match.group(1))
            elif match := re.match(r"^(?:answer|correct(?:\s*answer)?|ans|key)\s*:\s*(.+)$", line, re.IGNORECASE):
                raw_answer = match.group(1)
            elif match := re.match(r"^(?:explanation|model\s*answer|rationale|notes?)\s*:\s*(.+)$", line, re.IGNORECASE):
                explanation = match.group(1)
            elif match := re.match(r"^[\(\[]?([A-Fa-f])[\)\].:]\s+(.+)$", line):
                options.append({"id": match.group(1).upper(), "text": match.group(2).strip()})
            else:
                prompt_lines.append(line)

        raw_prompt = " ".join(prompt_lines)
        cleaned_prompt = re.sub(r"^(?:Q\d+[\.:]?|Question\s*\d+[\.:]?|\d+[\.:])\s*", "", raw_prompt, flags=re.IGNORECASE)
        question = _build_question(
            prompt=cleaned_prompt or raw_prompt,
            raw_kind=raw_kind,
            options=options,
            raw_answer=raw_answer,
            marks=marks,
            negative_marks=negative_marks,
            explanation=explanation or None,
        )
        if question is not None:
            questions.append(question)
    return questions


def _parse_tabular_row(raw_row: dict) -> QuestionInput | None:
    row = {
        re.sub(r"[\s_-]+", "_", str(key).strip().lower()): ("" if value is None else str(value).strip())
        for key, value in raw_row.items()
        if key is not None
    }
    prompt = row.get("prompt") or row.get("question") or row.get("question_text") or ""
    if not prompt:
        return None

    options = []
    for letter in ("a", "b", "c", "d", "e", "f"):
        text = row.get(f"option_{letter}") or row.get(letter) or ""
        if text:
            options.append({"id": letter.upper(), "text": text})

    raw_kind = row.get("kind") or row.get("type") or row.get("question_type") or ""
    raw_answer = row.get("correct_answer") or row.get("answer") or row.get("correct") or row.get("key") or ""
    explanation = row.get("explanation") or row.get("model_answer") or row.get("notes") or None

    try:
        marks = float(row["marks"]) if row.get("marks") else (5.0 if raw_kind.lower() == "theory" else 1.0)
    except ValueError:
        marks = 1.0

    negative_marks: float | None = None
    if row.get("negative_marks"):
        try:
            negative_marks = float(row["negative_marks"])
        except ValueError:
            negative_marks = None

    return _build_question(
        prompt=prompt,
        raw_kind=raw_kind,
        options=options,
        raw_answer=raw_answer,
        marks=marks,
        negative_marks=negative_marks,
        explanation=explanation,
    )


def parse_question_file(filename: str, content_bytes: bytes) -> list[QuestionInput]:
    lowered = filename.lower()
    if lowered.endswith(".xlsx"):
        import openpyxl

        workbook = openpyxl.load_workbook(io.BytesIO(content_bytes), data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(cell).strip() if cell is not None else f"col_{idx}" for idx, cell in enumerate(rows[0])]
        parsed: list[QuestionInput] = []
        for values in rows[1:]:
            if any(values):
                item = _parse_tabular_row(dict(zip(headers, values)))
                if item is not None:
                    parsed.append(item)
        return parsed

    text = content_bytes.decode("utf-8-sig", errors="replace")
    if lowered.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(text))
        return [item for row in reader if (item := _parse_tabular_row(row)) is not None]

    return _parse_text_paper(text)

