"""Local API for extracting evidence without sending documents to a model."""
from pathlib import Path
from typing import Annotated
import re

import pymupdf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles

from folio.extract import Review, extract

MAX_BYTES = 20 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1]
app = FastAPI(title="Folio Evidence Review", version="1.0.0")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/extract", response_model=Review)
def extract_pdf(
    request: Request, file: Annotated[UploadFile, File()], period: Annotated[str, Form()] = "2025",
) -> Review:
    origin = request.headers.get("origin")
    if origin and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "Use the Folio workspace on the same origin.")
    if not re.fullmatch(r"20\d{2}", period):
        raise HTTPException(422, "Choose a fiscal year between 2000 and 2099.")
    try:
        payload = file.file.read(MAX_BYTES + 1)
        if len(payload) > MAX_BYTES:
            raise HTTPException(413, "PDFs must be 20 MB or smaller.")
        if not payload.startswith(b"%PDF-"):
            raise HTTPException(415, "Choose a valid PDF file.")
        return extract(payload, Path(file.filename or "document.pdf").name, period)
    except (ValueError, RuntimeError, pymupdf.FileDataError) as error:
        raise HTTPException(422, "Unable to process this PDF. Use an unencrypted PDF with 1 to 500 pages.") from error
    finally:
        file.file.close()


if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="workspace")
