"""Emit normalized table cell coordinates from the local Docling models."""
import json
import os
import sys
from io import BytesIO

from docling.datamodel.base_models import DocumentStream, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption


def extract_tables(pdf: bytes):
    options = PdfPipelineOptions(
        artifacts_path=os.environ["FOLIO_DOCLING_MODELS"],
        do_table_structure=True,
        do_ocr=False,
        enable_remote_services=False,
    )
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)},
    )
    document = converter.convert(
        DocumentStream(name="workpaper.pdf", stream=BytesIO(pdf)), max_num_pages=1000
    ).document
    tables = []
    for table in document.tables:
        if len(table.prov) != 1:
            continue
        page = table.prov[0].page_no
        width, height = document.pages[page].size.as_tuple()
        cells = []
        for cell in table.data.table_cells:
            if not cell.bbox or not cell.text.strip():
                continue
            box = cell.bbox.to_top_left_origin(page_height=height)
            cells.append({
                "text": " ".join(cell.text.split()),
                "row": cell.start_row_offset_idx,
                "column": cell.start_col_offset_idx,
                "span": cell.col_span,
                "box": [max(0, min(1, value)) for value in
                        (box.l / width, box.t / height, box.r / width, box.b / height)],
            })
        if cells:
            tables.append({"page": page, "cells": cells})
    return tables


if __name__ == "__main__":
    print(json.dumps({"tables": extract_tables(sys.stdin.buffer.read())}))
