"""Regression tests for evidence identity, ambiguity, and document boundaries."""
from pathlib import Path
import unittest

import pymupdf
from fastapi.testclient import TestClient

from folio.api import app
from folio.extract import extract

PDF = Path(__file__).resolve().parents[1] / "public" / "demo" / "northfield-fy2025.pdf"


class TestWorkflow(unittest.TestCase):
    def test_sample_from_original_pdf(self):
        review = extract(PDF, PDF.name)
        self.assertEqual(review.pages, 400)
        metrics = {metric.id: metric for metric in review.metrics}
        self.assertEqual(metrics["revenue"].evidence[0].value, "128.4")
        self.assertEqual(metrics["revenue"].evidence[0].page, 18)
        self.assertEqual(metrics["ebitda"].status, "ready")
        self.assertEqual([item.basis for item in metrics["ebitda"].evidence], ["reported", "forecast"])
        self.assertEqual(metrics["debt"].status, "conflict")
        self.assertEqual([(item.page, item.value) for item in metrics["debt"].evidence], [(67, "83.2"), (284, "88.2")])
        self.assertEqual(metrics["cash"].status, "missing")
        for metric in metrics.values():
            for item in metric.evidence:
                x0, y0, x1, y1 = item.box
                self.assertTrue(0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1)

    def test_import_excludes_other_currencies_and_periods(self):
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((40, 40), "FY2024 actual Revenue: £1,234.50m")
            page.insert_text((40, 70), "FY2024 actual Revenue: 99m")
            page.insert_text((40, 100), "FY2024 reported Revenue: $98m")
            page.insert_text((40, 130), "FY2025 reported Revenue: £88m")
            page.set_rotation(90)
            response = TestClient(app).post("/api/extract", data={"period": "2024"},
                files={"file": ("different.pdf", document.tobytes(), "application/pdf")})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["pages"], 1)
        metric = data["metrics"][0]
        self.assertEqual(metric["period"], "FY2024")
        self.assertEqual([item["value"] for item in metric["evidence"]], ["1234.50"])
        x0, y0, x1, y1 = metric["evidence"][0]["box"]
        self.assertTrue(0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1)
        self.assertGreater(x0, 0.9)

    def test_malformed_pdf_returns_readable_error(self):
        client = TestClient(app)
        for payload, status in [(b"not a PDF", 415), (b"%PDF-broken", 422)]:
            with self.subTest(status=status):
                response = client.post("/api/extract", files={"file": ("broken.pdf", payload, "application/pdf")})
                self.assertEqual(response.status_code, status)


if __name__ == "__main__":
    unittest.main()
