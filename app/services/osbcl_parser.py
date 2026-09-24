"""Local OCR and anchor-based parsing for image-only OSBCL purchase orders."""
from __future__ import annotations

import re
from contextlib import suppress
from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import mean
from typing import Any


@dataclass
class ParsedLine:
    source_item_name: str
    size_ml: int | None
    cases: int
    loose_bottles: int
    case_rate: Decimal | None
    mger: Decimal | None
    amount: Decimal | None
    sequence: int
    confidence: float
    field_confidence: dict[str, float] = field(default_factory=dict)


@dataclass
class ParsedOrder:
    osbcl_token: str | None = None
    order_date: str | None = None
    order_type: str | None = None
    retailer_name: str | None = None
    retailer_code: str | None = None
    vehicle_number: str | None = None
    total_cases: int | None = None
    total_loose_bottles: int | None = None
    mger_total: Decimal | None = None
    order_total: Decimal | None = None
    confidence: float = 0.0
    review_flags: list[str] = field(default_factory=list)
    lines: list[ParsedLine] = field(default_factory=list)
    raw_ocr: dict[str, Any] = field(default_factory=dict)

    def jsonable(self) -> dict[str, Any]:
        value = asdict(self)
        for line in value["lines"]:
            for key in ("case_rate", "mger", "amount"):
                line[key] = str(line[key]) if line[key] is not None else None
        for key in ("mger_total", "order_total"):
            value[key] = str(value[key]) if value[key] is not None else None
        return value


class OsbclParseError(ValueError):
    pass


def inspect_pdf(path: Path, *, max_pages: int) -> int:
    import pymupdf

    try:
        document = pymupdf.open(path)
    except Exception as exc:
        raise OsbclParseError("The uploaded file is not a readable PDF") from exc
    try:
        if not document.is_pdf:
            raise OsbclParseError("Only PDF files are supported")
        if document.page_count < 1 or document.page_count > max_pages:
            raise OsbclParseError(f"PDF must contain between 1 and {max_pages} pages")
        return document.page_count
    finally:
        document.close()


def parse_osbcl_pdf(path: Path) -> ParsedOrder:
    import pymupdf
    from rapidocr_onnxruntime import RapidOCR

    document = pymupdf.open(path)
    engine = RapidOCR()
    pages: list[list[dict[str, Any]]] = []
    try:
        for page in document:
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
            result, _ = engine(pixmap.tobytes("png"))
            words = []
            for box, text, confidence in result or []:
                words.append(
                    {
                        "text": str(text).strip(),
                        "confidence": float(confidence),
                        "x0": min(point[0] for point in box),
                        "y0": min(point[1] for point in box),
                        "x1": max(point[0] for point in box),
                        "y1": max(point[1] for point in box),
                    }
                )
            pages.append(words)
    finally:
        document.close()
    return parse_ocr_pages(pages)


def parse_ocr_pages(pages: list[list[dict[str, Any]]]) -> ParsedOrder:
    if not pages:
        raise OsbclParseError("PDF contains no pages")
    joined = " ".join(word["text"] for page in pages for word in page)
    if "Odisha State Beverages Corporation" not in joined or "Purchase Order" not in joined:
        raise OsbclParseError("Unsupported document: OSBCL Purchase Order anchors were not found")

    order = ParsedOrder(raw_ocr={"pages": pages})
    first = pages[0]
    order.osbcl_token = _header_value(first, "Token No", 250, 610, multiline=True)
    raw_date = _header_value(first, "Token Date", 610, 830)
    if raw_date:
        match = re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{4}", raw_date)
        if match:
            with suppress(ValueError):
                order.order_date = datetime.strptime(match.group().replace("/", "-"), "%d-%m-%Y").date().isoformat()
    order.order_type = _header_value(first, "Order Type", 830, 1170)
    order.vehicle_number = _header_value(first, "Vehicle No", 830, 1170)
    retailer_text = " ".join(w["text"] for w in first if 300 <= w["x0"] < 830 and 380 <= w["y0"] < 550)
    code_match = re.search(r"Retailer\s*Code\s*[-:]?\s*([A-Z0-9]+)", retailer_text, re.I)
    order.retailer_code = code_match.group(1) if code_match else None
    order.retailer_name = retailer_text or None

    sequence = 1
    all_confidence: list[float] = []
    for page in pages:
        parsed = _parse_table_page(page, sequence)
        order.lines.extend(parsed)
        sequence += len(parsed)
        all_confidence.extend(line.confidence for line in parsed)

    total_match = re.search(
        r"Total\s+([\d,.]+)\s+Total MGER\s+([\d,.]+)\s+Total Amount\s+([\d,.]+)",
        joined,
        re.I,
    )
    if total_match:
        case_value = _decimal(total_match.group(1))
        if case_value is not None:
            order.total_cases = int(case_value)
            order.total_loose_bottles = int((case_value - int(case_value)) * 12 + Decimal("0.5"))
        order.mger_total = _decimal(total_match.group(2))
        order.order_total = _decimal(total_match.group(3))
    else:
        order.review_flags.append("Final OSBCL totals could not be read")

    if not order.osbcl_token:
        order.review_flags.append("Token number could not be read")
    if not order.order_date:
        order.review_flags.append("Token date could not be read")
    if not order.lines:
        order.review_flags.append("No order lines could be read")
    if order.lines and order.order_total is not None:
        line_total = sum((line.amount or Decimal(0)) for line in order.lines)
        if abs(line_total - order.order_total) > Decimal("0.05"):
            order.review_flags.append(f"Line amounts total {line_total:.2f}, expected {order.order_total:.2f}")
    if order.lines and order.mger_total is not None:
        line_mger = sum((line.mger or Decimal(0)) for line in order.lines)
        if abs(line_mger - order.mger_total) > Decimal("0.05"):
            order.review_flags.append(f"Line MGER totals {line_mger:.2f}, expected {order.mger_total:.2f}")
    if len({(line.source_item_name.casefold(), line.size_ml) for line in order.lines}) != len(order.lines):
        order.review_flags.append("Duplicate item lines require review")
    order.confidence = mean(all_confidence) if all_confidence else 0.0
    if order.confidence < 0.85:
        order.review_flags.append("OCR confidence is below 85%")
    return order


def _header_value(words: list[dict[str, Any]], label: str, x0: float, x1: float, *, multiline: bool = False) -> str | None:
    anchor = next((word for word in words if label.casefold() in word["text"].casefold()), None)
    if anchor is None:
        return None
    y0 = anchor["y0"] - 40
    y1 = anchor["y0"] + (60 if multiline else 55)
    candidates = [w for w in words if x0 <= w["x0"] < x1 and y0 <= w["y0"] <= y1 and label.casefold() not in w["text"].casefold()]
    inline = re.sub(rf"^.*?{re.escape(label)}\s*:?\s*", "", anchor["text"], flags=re.I)
    value = inline + "".join(w["text"] for w in sorted(candidates, key=lambda item: (item["y0"], item["x0"])))
    return value.strip(" :-") or None


def _parse_table_page(words: list[dict[str, Any]], sequence_start: int) -> list[ParsedLine]:
    header = next((w for w in words if "Item Name" in w["text"]), None)
    table_y = header["y1"] if header else 250
    rate_words = [w for w in words if 470 <= w["x0"] < 610 and w["y0"] > table_y and _decimal(w["text"]) is not None]
    rows: list[ParsedLine] = []
    for index, rate_word in enumerate(rate_words):
        y = rate_word["y0"]
        numeric = {}
        for key, low, high in (("cases", 600, 695), ("bottles", 695, 805), ("mger", 805, 935), ("amount", 935, 1110)):
            candidates = [w for w in words if low <= w["x0"] < high and abs(w["y0"] - y) <= 14 and _decimal(w["text"]) is not None]
            numeric[key] = min(candidates, key=lambda w: abs(w["y0"] - y)) if candidates else None
        if not all(numeric.values()):
            continue
        next_y = rate_words[index + 1]["y0"] if index + 1 < len(rate_words) else y + 80
        lower = y - 15
        upper = next_y - 15
        name_parts = [w for w in words if 105 <= w["x0"] < 470 and lower <= w["y0"] < upper]
        name = " ".join(w["text"].strip() for w in sorted(name_parts, key=lambda w: (w["y0"], w["x0"]))).strip()
        if not name or name.casefold() == "total":
            continue
        size_match = re.search(r"\(\s*0*(\d{2,4})\s*\)\s*$", name)
        confidences = [rate_word["confidence"], *(numeric[key]["confidence"] for key in numeric), *(w["confidence"] for w in name_parts)]
        rows.append(
            ParsedLine(
                source_item_name=name,
                size_ml=int(size_match.group(1)) if size_match else None,
                cases=int(_decimal(numeric["cases"]["text"]) or 0),
                loose_bottles=int(_decimal(numeric["bottles"]["text"]) or 0),
                case_rate=_decimal(rate_word["text"]),
                mger=_decimal(numeric["mger"]["text"]),
                amount=_decimal(numeric["amount"]["text"]),
                sequence=sequence_start + len(rows),
                confidence=mean(confidences),
                field_confidence={"item": mean(w["confidence"] for w in name_parts), "rate": rate_word["confidence"], **{key: numeric[key]["confidence"] for key in numeric}},
            )
        )
    return rows


def _decimal(value: str) -> Decimal | None:
    cleaned = re.sub(r"[^\d.-]", "", value.replace(",", ""))
    if not cleaned or cleaned in {"-", "."}:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None
