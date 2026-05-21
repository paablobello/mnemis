from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter
except Exception:  # pragma: no cover - exercised only in broken deployments.
    DocumentConverter = None  # type: ignore[assignment]
    InputFormat = None  # type: ignore[assignment]


DEFAULT_MAX_BYTES = 50 * 1024 * 1024


class ExtractRequest(BaseModel):
    url: str
    content_type: str = "application/pdf"
    content_sha256: str | None = None
    content_base64: str = Field(min_length=1)


class ExtractPage(BaseModel):
    page: int
    markdown: str | None = None
    text: str | None = None


class ExtractResponse(BaseModel):
    title: str | None = None
    pages: list[ExtractPage] = Field(default_factory=list)
    markdown: str | None = None
    text: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="Mnemis PDF Extractor", version="0.1.0")


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def decode_pdf(payload: ExtractRequest) -> bytes:
    try:
        pdf = base64.b64decode(payload.content_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="content_base64 is not valid base64") from exc

    max_bytes = env_int("PDF_EXTRACTOR_MAX_BYTES", DEFAULT_MAX_BYTES)
    if len(pdf) > max_bytes:
        raise HTTPException(status_code=413, detail=f"PDF exceeds PDF_EXTRACTOR_MAX_BYTES={max_bytes}")
    if len(pdf) == 0:
        raise HTTPException(status_code=400, detail="PDF payload is empty")
    return pdf


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split())


def docling_title(document: Any, fallback: str) -> str:
    title = clean_text(getattr(document, "title", None))
    if title:
        return title
    name = clean_text(getattr(document, "name", None))
    if name:
        return name
    return fallback


def item_page(item: Any) -> int | None:
    prov = getattr(item, "prov", None)
    if not prov:
        return None
    first = prov[0]
    page_no = getattr(first, "page_no", None)
    if isinstance(page_no, int) and page_no > 0:
        return page_no
    return None


def item_markdown(item: Any, document: Any) -> str:
    for kwargs in ({"doc": document}, {}):
        exporter = getattr(item, "export_to_markdown", None)
        if callable(exporter):
            try:
                text = exporter(**kwargs)
                if clean_text(text):
                    return str(text).strip()
            except TypeError:
                continue
            except Exception:
                break
    for attr in ("text", "orig", "caption"):
        text = clean_text(getattr(item, attr, None))
        if text:
            return text
    return clean_text(item)


def document_pages(document: Any, full_markdown: str) -> list[ExtractPage]:
    pages: dict[int, list[str]] = {}
    page_count = len(getattr(document, "pages", {}) or {})

    for collection_name in ("texts", "tables", "pictures"):
        for item in getattr(document, collection_name, []) or []:
            page = item_page(item)
            markdown = item_markdown(item, document)
            if page is None or not markdown:
                continue
            pages.setdefault(page, []).append(markdown)

    if pages:
        return [
            ExtractPage(page=page, markdown="\n\n".join(parts), text="\n\n".join(parts))
            for page, parts in sorted(pages.items())
            if clean_text("\n".join(parts))
        ]

    if page_count <= 1:
        return [ExtractPage(page=1, markdown=full_markdown, text=full_markdown)]

    # Last-resort page citation preservation. Some Docling versions expose full
    # markdown but not per-item provenance through the stable Python API.
    return [ExtractPage(page=1, markdown=full_markdown, text=full_markdown)]


def convert_with_docling(path: Path, source_url: str) -> tuple[str, list[ExtractPage], dict[str, Any]]:
    if DocumentConverter is None:
        raise RuntimeError("Docling is not installed")

    if InputFormat is None:
        converter = DocumentConverter()
    else:
        converter = DocumentConverter(allowed_formats=[InputFormat.PDF])
    result = converter.convert(path)
    document = result.document
    markdown = document.export_to_markdown()
    title = docling_title(document, Path(source_url).stem or "document")
    pages = document_pages(document, markdown)
    metadata = {
        "docling": {
            "pages": len(getattr(document, "pages", {}) or {}) or len(pages),
            "origin": str(getattr(document, "origin", "")),
        }
    }
    return title, pages, metadata


def tei_text(node: ElementTree.Element | None) -> str | None:
    if node is None:
        return None
    text = clean_text(" ".join(node.itertext()))
    return text or None


def parse_grobid_tei(tei: str) -> dict[str, Any]:
    root = ElementTree.fromstring(tei)
    ns = {"tei": "http://www.tei-c.org/ns/1.0"}
    title = tei_text(root.find(".//tei:titleStmt/tei:title", ns))
    abstract = tei_text(root.find(".//tei:abstract", ns))
    doi_node = root.find(".//tei:idno[@type='DOI']", ns)
    doi = tei_text(doi_node)
    authors: list[str] = []
    for author in root.findall(".//tei:fileDesc/tei:titleStmt/tei:author", ns):
        name = tei_text(author.find(".//tei:persName", ns))
        if name:
            authors.append(name)

    references: list[dict[str, Any]] = []
    for bibl in root.findall(".//tei:listBibl/tei:biblStruct", ns):
        ref_title = tei_text(bibl.find(".//tei:analytic/tei:title", ns)) or tei_text(
            bibl.find(".//tei:monogr/tei:title", ns)
        )
        ref_doi = tei_text(bibl.find(".//tei:idno[@type='DOI']", ns))
        if ref_title or ref_doi:
            references.append({"title": ref_title, "doi": ref_doi})

    return {
        key: value
        for key, value in {
            "title": title,
            "abstract": abstract,
            "doi": doi,
            "authors": authors,
            "references": references,
        }.items()
        if value
    }


async def enrich_with_grobid(path: Path) -> dict[str, Any]:
    if not env_bool("PDF_EXTRACTOR_ENABLE_GROBID", True):
        return {"enabled": False}

    base_url = os.getenv("PDF_EXTRACTOR_GROBID_URL", "http://grobid:8070").rstrip("/")
    timeout = env_int("PDF_EXTRACTOR_GROBID_TIMEOUT_SECONDS", 120)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            with path.open("rb") as pdf:
                response = await client.post(
                    f"{base_url}/api/processFulltextDocument",
                    files={"input": ("document.pdf", pdf, "application/pdf")},
                    data={"consolidateHeader": "1", "consolidateCitations": "1"},
                )
        response.raise_for_status()
        parsed = parse_grobid_tei(response.text)
        return {"enabled": True, **parsed}
    except Exception as exc:
        return {"enabled": True, "error": clean_text(exc)}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "docling_available": DocumentConverter is not None,
        "grobid_enabled": env_bool("PDF_EXTRACTOR_ENABLE_GROBID", True),
    }


@app.post("/extract", response_model=ExtractResponse)
async def extract(payload: ExtractRequest) -> ExtractResponse:
    pdf = decode_pdf(payload)
    with tempfile.TemporaryDirectory(prefix="mnemis-pdf-") as tmp:
        path = Path(tmp) / "document.pdf"
        path.write_bytes(pdf)
        try:
            title, pages, metadata = convert_with_docling(path, payload.url)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Docling extraction failed: {clean_text(exc)}") from exc

        grobid = await enrich_with_grobid(path)
        if grobid.get("title"):
            title = str(grobid["title"])

        metadata.update(
            {
                "extractor": "docling-grobid",
                "content_type": payload.content_type,
                "content_sha256": payload.content_sha256,
                "source_url": payload.url,
                "grobid": grobid,
            }
        )
        return ExtractResponse(title=title, pages=pages, metadata=metadata)
