"""Professional multi-sheet Excel (.xlsx), CSV, and JSON marks export services."""
import csv
import io
import statistics
from collections import Counter, defaultdict

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.clock import as_utc
from app.models import Answer, Attempt, Batch, Candidate, Enrollment, Exam, Question

PASS_THRESHOLD_PERCENT = 40.0

HEADER_FILL = PatternFill(start_color="312E81", end_color="312E81", fill_type="solid")
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
ZEBRA_FILL = PatternFill(start_color="F4F4F5", end_color="F4F4F5", fill_type="solid")
SUMMARY_FILL = PatternFill(start_color="EEF2FF", end_color="EEF2FF", fill_type="solid")
BOLD_FONT = Font(name="Calibri", size=11, bold=True)


def compute_letter_grade(percentage: float) -> str:
    if percentage >= 90:
        return "A+"
    if percentage >= 80:
        return "A"
    if percentage >= 70:
        return "B"
    if percentage >= 60:
        return "C"
    if percentage >= PASS_THRESHOLD_PERCENT:
        return "D"
    return "F"


def _csv_safe(value: object) -> str:
    text = "" if value is None else str(value)
    return f"'{text}" if text and text[0] in ("=", "+", "-", "@") else text


def _style_sheet(sheet, *, freeze_row: int = 2) -> None:
    sheet.freeze_panes = f"A{freeze_row}"
    for cell in sheet[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="left", vertical="center")
    sheet.row_dimensions[1].height = 24

    for row_idx in range(2, sheet.max_row + 1):
        if row_idx % 2 == 1:
            for cell in sheet[row_idx]:
                cell.fill = ZEBRA_FILL

    for col_idx in range(1, sheet.max_column + 1):
        max_len = max(
            (len(str(sheet.cell(row=r, column=col_idx).value or "")) for r in range(1, min(sheet.max_row + 1, 200))),
            default=10,
        )
        sheet.column_dimensions[get_column_letter(col_idx)].width = min(max(max_len + 3, 10), 42)


async def build_exam_marks_dataset(
    exam: Exam,
    db: AsyncSession,
    *,
    batch_id: str | None = None,
) -> dict:
    """Loads enrolled candidates, attempts, section scores, and per-question marks in bulk queries."""
    questions = (
        await db.execute(select(Question).where(Question.exam_id == exam.id).order_by(Question.position.asc()))
    ).scalars().all()
    question_by_id = {q.id: q for q in questions}
    total_max_marks = round(sum(float(q.marks) for q in questions), 2)

    query = (
        select(Enrollment, Candidate, Attempt)
        .join(Candidate, Candidate.id == Enrollment.candidate_id)
        .outerjoin(
            Attempt,
            (Attempt.candidate_id == Enrollment.candidate_id) & (Attempt.exam_id == Enrollment.exam_id),
        )
        .options(selectinload(Candidate.user), selectinload(Candidate.batch))
        .where(Enrollment.exam_id == exam.id)
        .order_by(Candidate.candidate_code.asc())
    )
    if batch_id:
        query = query.where(Candidate.batch_id == batch_id)
    rows = (await db.execute(query)).all()

    attempt_ids = [attempt.id for _, _, attempt in rows if attempt is not None]
    answers_by_attempt: dict[str, dict[str, Answer]] = defaultdict(dict)
    if attempt_ids:
        all_answers = (
            await db.execute(select(Answer).where(Answer.attempt_id.in_(attempt_ids)))
        ).scalars().all()
        for answer in all_answers:
            answers_by_attempt[answer.attempt_id][answer.question_id] = answer

    records = []
    submitted_percentages = []
    submitted_scores = []
    grade_counts: Counter[str] = Counter()

    for _, candidate, attempt in rows:
        objective_score = coding_score = theory_score = 0.0
        per_question = {}
        if attempt is not None:
            ans_map = answers_by_attempt.get(attempt.id, {})
            for q in questions:
                ans = ans_map.get(q.id)
                earned = float(ans.awarded_marks) if (ans and ans.awarded_marks is not None) else 0.0
                per_question[q.position] = round(earned, 2)
                if q.kind == "coding":
                    coding_score += earned
                elif q.kind == "theory":
                    theory_score += earned
                else:
                    objective_score += earned

        max_score = attempt.max_score if (attempt and attempt.max_score) else total_max_marks
        total_score = round(float(attempt.score), 2) if (attempt and attempt.score is not None) else None
        pct = round((total_score / max_score) * 100, 1) if (total_score is not None and max_score > 0) else None
        grade = compute_letter_grade(pct) if pct is not None else "—"
        result_label = ("PASS" if pct >= PASS_THRESHOLD_PERCENT else "FAIL") if pct is not None else "ABSENT"

        duration_mins = None
        if attempt and attempt.submitted_at and attempt.started_at:
            duration_mins = round(max(0.0, (as_utc(attempt.submitted_at) - as_utc(attempt.started_at)).total_seconds() / 60), 1)

        if attempt and attempt.status == "submitted" and total_score is not None and pct is not None:
            submitted_scores.append(total_score)
            submitted_percentages.append(pct)
            grade_counts[grade] += 1

        records.append(
            {
                "candidate_code": candidate.candidate_code,
                "full_name": candidate.user.full_name,
                "username": candidate.user.username,
                "email": candidate.user.email or "",
                "batch": candidate.batch.name if candidate.batch else "",
                "status": attempt.status if attempt else "not_started",
                "objective_score": round(objective_score, 2) if attempt else None,
                "coding_score": round(coding_score, 2) if attempt else None,
                "theory_score": round(theory_score, 2) if attempt else None,
                "total_score": total_score,
                "max_score": max_score,
                "percentage": pct,
                "grade": grade,
                "result": result_label,
                "violations": attempt.violation_count if attempt else 0,
                "duration_minutes": duration_mins,
                "submit_reason": attempt.submit_reason if attempt else "",
                "submitted_at": as_utc(attempt.submitted_at).isoformat() if (attempt and attempt.submitted_at) else "",
                "per_question": per_question,
            }
        )

    summary = {
        "exam_id": exam.id,
        "exam_title": exam.title,
        "enrolled": len(records),
        "submitted": len(submitted_scores),
        "max_marks": total_max_marks,
        "mean": round(statistics.fmean(submitted_scores), 2) if submitted_scores else 0.0,
        "median": round(statistics.median(submitted_scores), 2) if submitted_scores else 0.0,
        "std_dev": round(statistics.pstdev(submitted_scores), 2) if len(submitted_scores) > 1 else 0.0,
        "highest": round(max(submitted_scores), 2) if submitted_scores else 0.0,
        "lowest": round(min(submitted_scores), 2) if submitted_scores else 0.0,
        "pass_rate": round(
            sum(1 for p in submitted_percentages if p >= PASS_THRESHOLD_PERCENT) / len(submitted_percentages) * 100, 1
        )
        if submitted_percentages
        else 0.0,
        "grade_distribution": {grade: grade_counts.get(grade, 0) for grade in ("A+", "A", "B", "C", "D", "F")},
    }
    return {"exam": exam, "questions": questions, "records": records, "summary": summary}


def render_exam_xlsx(dataset: dict) -> bytes:
    workbook = openpyxl.Workbook()

    # Sheet 1: Marks Sheet
    marks_sheet = workbook.active
    marks_sheet.title = "Marks Sheet"
    marks_sheet.append(
        [
            "Roll / Code",
            "Student Name",
            "Username",
            "Batch",
            "Status",
            "Objective",
            "Coding",
            "Theory",
            "Total Score",
            "Max Marks",
            "Percentage (%)",
            "Grade",
            "Result",
            "Violations",
            "Duration (min)",
            "Submitted At (UTC)",
        ]
    )
    for row in dataset["records"]:
        marks_sheet.append(
            [
                row["candidate_code"],
                row["full_name"],
                row["username"],
                row["batch"] or "—",
                row["status"],
                row["objective_score"],
                row["coding_score"],
                row["theory_score"],
                row["total_score"],
                row["max_score"],
                row["percentage"],
                row["grade"],
                row["result"],
                row["violations"],
                row["duration_minutes"],
                row["submitted_at"],
            ]
        )
    _style_sheet(marks_sheet)

    # Sheet 2: Question-wise Matrix
    matrix_sheet = workbook.create_sheet("Question Breakdown")
    questions: list[Question] = dataset["questions"]
    matrix_sheet.append(
        ["Roll / Code", "Student Name", "Batch"]
        + [f"Q{q.position} ({q.marks}m)" for q in questions]
        + ["Total", "Percentage (%)"]
    )
    for row in dataset["records"]:
        matrix_sheet.append(
            [row["candidate_code"], row["full_name"], row["batch"] or "—"]
            + [row["per_question"].get(q.position, "") for q in questions]
            + [row["total_score"], row["percentage"]]
        )
    _style_sheet(matrix_sheet)

    # Sheet 3: Exam Summary & Grade Distribution
    summary_sheet = workbook.create_sheet("Summary & Grades")
    summary = dataset["summary"]
    summary_sheet.append(["Metric", "Value"])
    for label, value in (
        ("Examination", summary["exam_title"]),
        ("Total Enrolled", summary["enrolled"]),
        ("Submitted", summary["submitted"]),
        ("Maximum Marks", summary["max_marks"]),
        ("Mean Score", summary["mean"]),
        ("Median Score", summary["median"]),
        ("Standard Deviation", summary["std_dev"]),
        ("Highest Score", summary["highest"]),
        ("Lowest Score", summary["lowest"]),
        ("Pass Rate (>= 40%)", f"{summary['pass_rate']}%"),
    ):
        summary_sheet.append([label, value])
    summary_sheet.append([])
    summary_sheet.append(["Grade", "Student Count"])
    for grade, count in summary["grade_distribution"].items():
        summary_sheet.append([grade, count])
    _style_sheet(summary_sheet)

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


async def build_consolidated_marks_xlsx(db: AsyncSession, *, batch_id: str | None = None) -> bytes:
    """Exports a cross-exam consolidated marks register for a batch or all students."""
    cand_query = (
        select(Candidate)
        .options(selectinload(Candidate.user), selectinload(Candidate.batch))
        .order_by(Candidate.candidate_code.asc())
    )
    if batch_id:
        cand_query = cand_query.where(Candidate.batch_id == batch_id)
    candidates = (await db.execute(cand_query)).scalars().all()
    exams = (
        await db.execute(select(Exam).where(Exam.lifecycle_state != "draft").order_by(Exam.created_at.asc()))
    ).scalars().all()

    cand_ids = [c.id for c in candidates]
    attempts_map: dict[tuple[str, str], Attempt] = {}
    if cand_ids and exams:
        attempt_rows = (
            await db.execute(
                select(Attempt).where(Attempt.candidate_id.in_(cand_ids), Attempt.status == "submitted")
            )
        ).scalars().all()
        for attempt in attempt_rows:
            attempts_map[(attempt.candidate_id, attempt.exam_id)] = attempt

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Consolidated Marks"
    sheet.append(
        ["Roll / Code", "Student Name", "Batch"]
        + [exam.title[:28] for exam in exams]
        + ["Exams Taken", "Total Earned", "Total Possible", "Overall %", "Overall Grade"]
    )

    for candidate in candidates:
        earned_sum = 0.0
        max_sum = 0.0
        taken = 0
        exam_cells = []
        for exam in exams:
            attempt = attempts_map.get((candidate.id, exam.id))
            if attempt is not None and attempt.score is not None:
                taken += 1
                earned_sum += float(attempt.score)
                max_sum += float(attempt.max_score or 0.0)
                exam_cells.append(f"{attempt.score}/{attempt.max_score}")
            else:
                exam_cells.append("—")

        overall_pct = round((earned_sum / max_sum) * 100, 1) if max_sum > 0 else 0.0
        sheet.append(
            [candidate.candidate_code, candidate.user.full_name, candidate.batch.name if candidate.batch else "—"]
            + exam_cells
            + [taken, round(earned_sum, 2), round(max_sum, 2), overall_pct if taken else "—", compute_letter_grade(overall_pct) if taken else "—"]
        )

    _style_sheet(sheet)
    buf = io.BytesIO()
    workbook.save(buf)
    return buf.getvalue()


def render_exam_csv(dataset: dict) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "candidate_code",
            "full_name",
            "username",
            "batch",
            "status",
            "objective_score",
            "coding_score",
            "theory_score",
            "total_score",
            "max_score",
            "percentage",
            "grade",
            "result",
            "violations",
            "duration_minutes",
            "submitted_at",
        ]
    )
    for row in dataset["records"]:
        writer.writerow(
            [
                _csv_safe(row["candidate_code"]),
                _csv_safe(row["full_name"]),
                _csv_safe(row["username"]),
                _csv_safe(row["batch"]),
                row["status"],
                row["objective_score"] if row["objective_score"] is not None else "",
                row["coding_score"] if row["coding_score"] is not None else "",
                row["theory_score"] if row["theory_score"] is not None else "",
                row["total_score"] if row["total_score"] is not None else "",
                row["max_score"],
                row["percentage"] if row["percentage"] is not None else "",
                row["grade"],
                row["result"],
                row["violations"],
                row["duration_minutes"] if row["duration_minutes"] is not None else "",
                row["submitted_at"],
            ]
        )
    return buffer.getvalue()
