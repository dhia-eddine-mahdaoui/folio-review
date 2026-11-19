"""Extract supported financial metrics and preserve source coordinates."""
from decimal import Decimal
from pathlib import Path
import re

import pymupdf
from pydantic import BaseModel

MAX_PAGES = 500
METRICS = {
    "revenue": ("Revenue", "revenue|net sales", "GBP m"),
    "ebitda": ("Adjusted EBITDA", "adjusted ebitda", "GBP m"),
    "debt": ("Net debt", "net debt", "GBP m"),
    "cash": ("Free cash flow", "free cash flow", "GBP m"),
}
NUMBER = r"-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"


class Evidence(BaseModel):
    page: int
    quote: str
    box: tuple[float, float, float, float]
    value: str
    basis: str


class Metric(BaseModel):
    id: str
    name: str
    unit: str
    period: str
    status: str
    reason: str
    evidence: list[Evidence]


class Review(BaseModel):
    title: str
    filename: str
    pages: int
    metrics: list[Metric]
    text_pages: int


def _pattern(labels: str) -> re.Pattern:
    return re.compile(
        rf"^(?:FY\s*)?(?P<period>20\d{{2}})\s+(?P<basis>actual|reported|provisional|forecast)"
        rf"\s+(?:{labels})\s*[:\-]\s*(?:£|GBP\s*)(?P<value>{NUMBER})\s*(?:m|million)"
        rf"(?:\s+GBP)?(?:\s*[.;])?$",
        re.IGNORECASE,
    )


def extract(source: Path | bytes, filename: str, period: str = "2025") -> Review:
    patterns = {key: _pattern(labels) for key, (_, labels, _) in METRICS.items()}
    candidates: dict[str, list[Evidence]] = {key: [] for key in METRICS}
    document = pymupdf.open(stream=source, filetype="pdf") if isinstance(source, bytes) else pymupdf.open(source)
    with document:
        if not document.is_pdf or document.needs_pass or not 1 <= len(document) <= MAX_PAGES:
            raise ValueError("Use an unencrypted PDF with 1 to 500 pages.")
        text_pages = 0
        for page in document:
            # Coordinates returned by extraction refer to the unrotated page.
            width, height = page.cropbox.width, page.cropbox.height
            blocks = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]
            text_pages += bool(blocks)
            for block in blocks:
                for line in block.get("lines", []):
                    quote = "".join(span["text"] for span in line["spans"]).strip()
                    for key, pattern in patterns.items():
                        match = pattern.fullmatch(quote)
                        if not match or match["period"] != period:
                            continue
                        rect = pymupdf.Rect(line["bbox"])
                        rect = rect * page.rotation_matrix
                        page_width, page_height = (height, width) if page.rotation in (90, 270) else (width, height)
                        x0, y0, x1, y1 = rect
                        candidates[key].append(Evidence(
                            page=page.number + 1, quote=quote,
                            box=(x0 / page_width, y0 / page_height, x1 / page_width, y1 / page_height),
                            value=format(Decimal(match["value"].replace(",", "")), "f"),
                            basis=match["basis"].lower(),
                        ))
        metrics = []
        for key, (name, _, unit) in METRICS.items():
            evidence = candidates[key]
            final_values = {Decimal(item.value) for item in evidence if item.basis in {"actual", "reported"}}
            non_forecast = {Decimal(item.value) for item in evidence if item.basis != "forecast"}
            if not evidence:
                status, reason = "missing", "No matching source was found for this period and unit."
            elif len(non_forecast) > 1:
                status, reason = "conflict", "Sources disagree for the same period. Check the reporting basis before approving."
            elif not final_values:
                status, reason = "limited", "Only provisional or forecast evidence was found."
            else:
                status, reason = "ready", "Reported evidence is available. Verify the figure before approving."
            metrics.append(Metric(id=key, name=name, unit=unit, period=f"FY{period}", status=status, reason=reason, evidence=evidence))
        title = (document.metadata or {}).get("title") or Path(filename).stem
        return Review(title=title, filename=filename, pages=len(document), metrics=metrics, text_pages=text_pages)
