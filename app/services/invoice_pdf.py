"""PDF invoice renderer (R-43, D-62).

Generates a single-page (or short multi-page) PDF for a finalized
invoice. The reportlab API is the cheapest way to do this without
adding a heavy deps tree; we don't need HTML templating or fonts.

The output is a one-shot byte string suitable for `Response(content=...)`.
"""
from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.invoice import Invoice


def render_invoice_pdf(invoice: Invoice) -> bytes:
    """Render `invoice` (already loaded with `lines` and `payments`) to
    a PDF byte string."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Invoice #{invoice.invoice_number:06d}",
    )
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("TAX INVOICE", styles["Title"]))
    story.append(
        Paragraph(
            f"<b>Invoice #</b> {invoice.invoice_number:06d} &nbsp;&nbsp; "
            f"<b>Date:</b> {invoice.finalized_at.strftime('%Y-%m-%d %H:%M')}",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 6 * mm))

    # Lines table.
    line_data = [["#", "Product", "Qty", "Unit Price", "Line Total"]]
    for idx, line in enumerate(invoice.lines, start=1):
        line_data.append(
            [
                str(idx),
                str(line.product_id),
                str(line.quantity),
                f"{line.unit_price:.2f}",
                f"{line.line_total:.2f}",
            ]
        )
    line_table = Table(line_data, colWidths=[12 * mm, 70 * mm, 18 * mm, 30 * mm, 35 * mm])
    line_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(line_table)
    story.append(Spacer(1, 6 * mm))

    # Totals + payments.
    story.append(
        Paragraph(
            f"<b>Total:</b> {invoice.total_amount:.2f}",
            styles["Heading3"],
        )
    )
    story.append(Spacer(1, 3 * mm))
    if invoice.payments:
        pay_data = [["Mode", "Amount"]]
        for p in invoice.payments:
            pay_data.append([p.mode.value.upper(), f"{p.amount:.2f}"])
        pay_table = Table(pay_data, colWidths=[40 * mm, 40 * mm])
        pay_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                ]
            )
        )
        story.append(pay_table)

    if invoice.note:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(f"<b>Note:</b> {invoice.note}", styles["Normal"]))

    story.append(Spacer(1, 10 * mm))
    story.append(
        Paragraph(
            "<i>Thank you for your purchase. GST/excise line is shown for "
            "reference only; see Odisha State Excise Department rules for the "
            "applicable duty rate before relying on this figure for filings.</i>",
            styles["Italic"],
        )
    )

    doc.build(story)
    return buf.getvalue()
