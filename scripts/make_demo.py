"""Build the fictional 400-page PDF and its reproducible extraction snapshot."""
from pathlib import Path

import pymupdf

from folio.extract import extract

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
TITLE = "Northfield Components"
SPECIAL = {
    18: (
        "Operating performance", "01 / MANAGEMENT REVIEW",
        "Northfield Components closed the year with higher sales across both operating segments. The table below presents selected group-level results for the year ended 31 December 2025.",
        "FY2025 reported Revenue: £128.4m", "FY2024 reported Revenue: £116.8m", "Group revenue includes the Precision Systems and Industrial Services segments. All reported figures are in GBP millions.",
    ),
    42: (
        "Financial highlights", "02 / FINANCIAL REVIEW",
        "These figures reflect the final management reporting pack, prepared after the year-end close. The adjustments described in the notes are included in the reported EBITDA figure.",
        "FY2025 reported Adjusted EBITDA: £24.6m", "FY2025 forecast Adjusted EBITDA: £26.1m", "The forecast was prepared in September, ahead of year-end close. Use the reported result when updating the investment committee model.",
    ),
    67: (
        "Capital structure", "03 / BALANCE SHEET",
        "The audited year-end schedule consolidates drawn borrowings and cash balances. The figure below includes lease liabilities as described in the final reporting policy.",
        "FY2025 actual Net debt: £83.2m", "FY2024 actual Net debt: £79.8m", "Financial review completed after closing adjustments. This schedule supersedes the provisional treasury schedule in Appendix D.",
    ),
    284: (
        "Treasury schedule", "APPENDIX D / MANAGEMENT DRAFT",
        "This provisional schedule was circulated before the year-end reconciliation. Figures are subject to the closing adjustment for lease obligations.",
        "FY2025 provisional Net debt: £88.2m", "FY2024 provisional Net debt: £79.8m", "Use the final balance sheet schedule for the investment committee model. Retain this appendix for reconciliation.",
    ),
}


def make() -> None:
    path = OUT / "northfield-fy2025.pdf"
    ink, muted, green, line = (0.10, 0.17, 0.15), (0.33, 0.37, 0.35), (0.12, 0.29, 0.23), (0.85, 0.88, 0.85)
    with pymupdf.open() as doc:
        doc.set_metadata({"title": TITLE, "author": "Folio demo", "subject": "Fictional investment diligence pack"})
        for number in range(1, 401):
            page = doc.new_page(width=540, height=640)
            page.insert_text((42, 49), "NORTHFIELD", fontname="hebo", fontsize=13, color=green)
            page.insert_text((42, 64), "C O M P O N E N T S", fontsize=7.5, color=green)
            page.insert_text((372, 55), "FY2025  /  DILIGENCE PACK", fontsize=8, color=muted)
            page.draw_line((42, 81), (498, 81), color=line)
            if number in SPECIAL:
                heading, section, intro, first, second, note = SPECIAL[number]
            else:
                heading, section, intro = ("Investment diligence pack", "GROUP REPORT / FY2025", "Fictional background material for the financial evidence review exercise.")
                first, second, note = "Northfield Components Group", "Year ended 31 December 2025", "Supporting document. This page contains no metric figures in the review scope."
            page.insert_text((42, 121), section, fontname="hebo", fontsize=9, color=green)
            page.insert_text((42, 156), heading, fontname="tibo", fontsize=31, color=ink)
            page.insert_textbox((42, 180, 485, 248), intro, fontsize=12, color=muted, lineheight=1.35)
            page.draw_rect((42, 253, 498, 362), color=line, fill=(0.97, 0.98, 0.96))
            page.insert_text((56, 276), "SELECTED FIGURES" if number in SPECIAL else "DOCUMENT SCOPE", fontname="hebo", fontsize=9, color=green)
            page.draw_line((56, 288), (484, 288), color=line)
            page.insert_text((56, 313), first, fontname="hebo", fontsize=12, color=ink)
            page.insert_text((56, 339), second, fontsize=11, color=muted)
            page.insert_text((42, 395), "Reporting notes", fontname="hebo", fontsize=12, color=ink)
            page.insert_textbox((42, 410, 485, 490), note, fontsize=11, color=muted, lineheight=1.4)
            page.draw_line((42, 586), (498, 586), color=line)
            page.insert_text((42, 605), "FICTIONAL FINANCIAL DATA  /  PORTFOLIO SAMPLE", fontsize=8, color=muted)
            page.insert_text((456, 605), f"{number:03} / 400", fontsize=8, color=muted)
        doc.save(path, garbage=4, deflate=True)
    (OUT / "review.json").write_text(extract(path, path.name).model_dump_json(indent=2) + "\n")


if __name__ == "__main__":
    make()
