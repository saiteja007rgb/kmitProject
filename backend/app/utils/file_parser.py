import csv
import io
import re
from typing import List, Dict, Any, Optional

def parse_txt_question_paper(text_content: str) -> List[Dict[str, Any]]:
    """
    Parses a plain text question paper into structured questions.
    Supports both MCQ and Theory/Descriptive questions.
    """
    questions: List[Dict[str, Any]] = []
    
    # Split text by double newlines or question markers (e.g. Q1., Question 1:, 1.)
    raw_blocks = re.split(r'\n\s*\n+', text_content.strip())
    
    for block in raw_blocks:
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        if not lines:
            continue
        
        q_text_lines = []
        options: List[Dict[str, str]] = []
        correct_answer = ""
        question_type = "mcq"
        marks = 1.0
        negative_marks = 0.0
        explanation = ""
        
        # Check if block explicitly mentions theory/subjective
        if any(re.search(r'\b(theory|subjective|descriptive)\b', l, re.IGNORECASE) for l in lines):
            question_type = "theory"
            marks = 5.0

        for line in lines:
            # Check for Type: line
            type_match = re.match(r'^(?:type|question_type)\s*:\s*(.+)$', line, re.IGNORECASE)
            if type_match:
                t_val = type_match.group(1).strip().lower()
                question_type = "theory" if "theory" in t_val or "sub" in t_val or "desc" in t_val else "mcq"
                continue

            # Check for Marks: line
            marks_match = re.match(r'^(?:marks?|points?)\s*:\s*([\d\.]+)$', line, re.IGNORECASE)
            if marks_match:
                try:
                    marks = float(marks_match.group(1))
                except ValueError:
                    pass
                continue

            # Check for Negative marks: line
            neg_match = re.match(r'^(?:negative(?:\s*marks?)?|penalty)\s*:\s*([\d\.]+)$', line, re.IGNORECASE)
            if neg_match:
                try:
                    negative_marks = float(neg_match.group(1))
                except ValueError:
                    pass
                continue

            # Check for Answer: line
            ans_match = re.match(r'^(?:answer|correct(?:\s*answer)?|ans|key)\s*:\s*(.+)$', line, re.IGNORECASE)
            if ans_match:
                correct_answer = ans_match.group(1).strip()
                continue

            # Check for Explanation: line
            exp_match = re.match(r'^(?:explanation|explain|rationale|notes?)\s*:\s*(.+)$', line, re.IGNORECASE)
            if exp_match:
                explanation = exp_match.group(1).strip()
                continue

            # Check for MCQ Options: A) text or [A] text or A. text or (A) text
            opt_match = re.match(r'^(?:[\(\[]?([A-Da-d])[\)\].:\s])\s*(.+)$', line)
            if opt_match and question_type != "theory":
                opt_id = opt_match.group(1).upper()
                opt_text = opt_match.group(2).strip()
                options.append({"id": opt_id, "text": opt_text})
                continue

            # Otherwise, it's part of the question text
            q_text_lines.append(line)

        raw_q_text = " ".join(q_text_lines).strip()
        # Clean prefix like "Q1.", "1.", "Question 1:"
        cleaned_q_text = re.sub(r'^(?:Q\d+[\.:]?|Question\s*\d+[\.:]?|\d+[\.:])\s*', '', raw_q_text, flags=re.IGNORECASE).strip()
        if not cleaned_q_text:
            cleaned_q_text = raw_q_text

        if not cleaned_q_text:
            continue

        # If no options were found, it's automatically a Theory question
        if not options:
            question_type = "theory"
            if marks == 1.0:
                marks = 5.0
        else:
            question_type = "mcq"
            # Normalize correct_answer for MCQ (e.g. "A" or "Option A")
            if correct_answer:
                first_letter = re.search(r'[A-Da-d]', correct_answer)
                if first_letter:
                    correct_answer = first_letter.group(0).upper()
            if not correct_answer and options:
                correct_answer = "A"

        questions.append({
            "question_text": cleaned_q_text,
            "question_type": question_type,
            "options": options if question_type == "mcq" else [],
            "correct_answer": correct_answer,
            "marks": marks,
            "negative_marks": negative_marks,
            "explanation": explanation
        })

    return questions


def _parse_row(row_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Normalize keys to lower snake
    normalized = {}
    for k, v in row_dict.items():
        if k is not None:
            norm_k = re.sub(r'[\s_\-]+', '_', str(k).strip().lower())
            normalized[norm_k] = str(v).strip() if v is not None else ""

    q_text = (
        normalized.get("question") or
        normalized.get("question_text") or
        normalized.get("prompt") or
        normalized.get("title") or ""
    )
    if not q_text:
        return None

    # Check for options
    opt_a = normalized.get("option_a") or normalized.get("a") or ""
    opt_b = normalized.get("option_b") or normalized.get("b") or ""
    opt_c = normalized.get("option_c") or normalized.get("c") or ""
    opt_d = normalized.get("option_d") or normalized.get("d") or ""

    type_val = (normalized.get("type") or normalized.get("question_type") or "").lower()
    
    options = []
    if opt_a:
        options.append({"id": "A", "text": opt_a})
    if opt_b:
        options.append({"id": "B", "text": opt_b})
    if opt_c:
        options.append({"id": "C", "text": opt_c})
    if opt_d:
        options.append({"id": "D", "text": opt_d})

    if "theory" in type_val or "desc" in type_val or "sub" in type_val or (not options and type_val != "mcq"):
        question_type = "theory"
        options = []
    else:
        question_type = "mcq"

    ans_raw = normalized.get("answer") or normalized.get("correct_answer") or normalized.get("correct") or normalized.get("key") or ""
    correct_answer = ans_raw.strip()
    if question_type == "mcq" and correct_answer:
        m = re.search(r'[A-Da-d]', correct_answer)
        if m:
            correct_answer = m.group(0).upper()
        elif options:
            correct_answer = "A"

    try:
        marks = float(normalized.get("marks") or (5.0 if question_type == "theory" else 1.0))
    except ValueError:
        marks = 5.0 if question_type == "theory" else 1.0

    try:
        neg_marks = float(normalized.get("negative_marks") or normalized.get("negative") or 0.0)
    except ValueError:
        neg_marks = 0.0

    explanation = normalized.get("explanation") or normalized.get("rationale") or normalized.get("notes") or ""

    return {
        "question_text": q_text,
        "question_type": question_type,
        "options": options,
        "correct_answer": correct_answer,
        "marks": marks,
        "negative_marks": neg_marks,
        "explanation": explanation
    }


def parse_csv_question_paper(csv_content: str) -> List[Dict[str, Any]]:
    """Parses a CSV file containing questions."""
    reader = csv.DictReader(io.StringIO(csv_content))
    questions: List[Dict[str, Any]] = []
    for row in reader:
        item = _parse_row(row)
        if item:
            questions.append(item)
    return questions


def parse_xlsx_question_paper(file_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Parses an XLSX Excel file into questions using openpyxl,
    with zero-dependency fallback.
    """
    questions: List[Dict[str, Any]] = []
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheet = wb.active
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            return []
        
        headers = [str(cell).strip() if cell is not None else f"col_{idx}" for idx, cell in enumerate(rows[0])]
        
        for row in rows[1:]:
            if not any(row):
                continue
            row_dict = {}
            for h, cell in zip(headers, row):
                row_dict[h] = cell
            item = _parse_row(row_dict)
            if item:
                questions.append(item)
        return questions
    except Exception as e:
        # Fallback to text extraction or error
        pass

    return questions


def parse_uploaded_question_file(filename: str, content_bytes: bytes) -> List[Dict[str, Any]]:
    """Universal dispatcher for question paper files (.txt, .xlsx, .csv)."""
    lower_name = filename.lower()
    if lower_name.endswith('.xlsx'):
        return parse_xlsx_question_paper(content_bytes)
    elif lower_name.endswith('.csv'):
        text = content_bytes.decode('utf-8', errors='replace')
        return parse_csv_question_paper(text)
    else:
        # Default to txt parsing
        text = content_bytes.decode('utf-8', errors='replace')
        return parse_txt_question_paper(text)
