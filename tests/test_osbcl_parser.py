"""Anchor parser tests without invoking the native OCR engine."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.osbcl_parser import OsbclParseError, parse_ocr_pages


def _word(text: str, x: float, y: float, confidence: float = 0.99) -> dict:
    return {"text": text, "confidence": confidence, "x0": x, "y0": y, "x1": x + 40, "y1": y + 20}


def _page(*, confidence: float = 0.99, duplicate: bool = False) -> list[dict]:
    words = [
        _word("Odisha State Beverages Corporation Ltd", 180, 70),
        _word("Purchase Order", 460, 240),
        _word("OD-KHO(T)/9/2026-", 320, 309),
        _word("Token Date : 19-", 632, 310),
        _word("Order Type :", 857, 309),
        _word("Token No :", 133, 334),
        _word("2027", 320, 353),
        _word("09-2026", 633, 354),
        _word("Beer", 854, 350),
        _word("Item Name", 122, 970),
        _word("Test Premium Beer(650)", 123, 1026, confidence),
        _word("1,949.73", 492, 1029, confidence),
        _word("2", 633, 1030, confidence),
        _word("0", 735, 1030, confidence),
        _word("1,548.18", 823, 1029, confidence),
        _word("3,899.46", 974, 1029, confidence),
    ]
    if duplicate:
        words.extend([
            _word("Test Premium Beer(650)", 123, 1126),
            _word("1,949.73", 492, 1129),
            _word("2", 633, 1130),
            _word("0", 735, 1130),
            _word("1,548.18", 823, 1129),
            _word("3,899.46", 974, 1129),
        ])
    multiplier = 2 if duplicate else 1
    words.extend([
        _word("Total", 122, 1250),
        _word(f"{2 * multiplier}.0000", 250, 1250),
        _word("Total MGER", 373, 1250),
        _word(f"{Decimal('1548.18') * multiplier:,.2f}", 596, 1250),
        _word("Total Amount", 748, 1250),
        _word(f"{Decimal('3899.46') * multiplier:,.2f}", 942, 1250),
    ])
    return words


def test_parses_header_indian_numbers_and_case_row() -> None:
    result = parse_ocr_pages([_page()])
    assert result.osbcl_token == "OD-KHO(T)/9/2026-2027"
    assert result.order_date == "2026-09-19"
    assert result.order_type == "Beer"
    assert result.mger_total == Decimal("1548.18")
    assert result.order_total == Decimal("3899.46")
    assert result.lines[0].size_ml == 650
    assert result.lines[0].cases == 2
    assert result.review_flags == []


def test_low_confidence_and_duplicate_lines_are_review_flags() -> None:
    result = parse_ocr_pages([_page(confidence=0.50, duplicate=True)])
    assert len(result.lines) == 2
    assert "Duplicate item lines require review" in result.review_flags
    assert "OCR confidence is below 85%" in result.review_flags


def test_rejects_non_osbcl_layout() -> None:
    with pytest.raises(OsbclParseError, match="Unsupported document"):
        parse_ocr_pages([[_word("unrelated invoice", 10, 10)]])
