from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

import faiss
import numpy as np
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader


DIMENSION = 4096
CHUNK_SIZE = 950
CHUNK_OVERLAP = 160
USER_AGENT = "DirectPurchaseLanguageAgent/0.1"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


@dataclass
class Source:
    id: str
    title: str
    url: str
    source: str
    category: str
    publishedAt: str


def server_root() -> Path:
    return Path(__file__).resolve().parents[1]


def normalize_text(value: str) -> str:
    value = value.replace("\u00a0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def safe_filename(source: Source, content_type: str) -> str:
    suffix = ".pdf" if "pdf" in content_type.lower() or "filedownload" in source.url.lower() else ".html"
    return f"{source.id}{suffix}"


def fetch_source(source: Source, raw_dir: Path) -> tuple[Path, str]:
    response = requests.get(
        source.url,
        headers={"User-Agent": USER_AGENT},
        timeout=30,
        allow_redirects=True,
    )
    response.raise_for_status()

    content_type = response.headers.get("content-type", "")
    raw_path = raw_dir / safe_filename(source, content_type)
    raw_path.write_bytes(response.content)
    return raw_path, content_type


def extract_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return normalize_text("\n\n".join(pages))


def extract_html(path: Path) -> str:
    raw = path.read_bytes()
    soup = BeautifulSoup(raw, "html.parser")

    for tag in soup(["script", "style", "noscript", "svg", "canvas", "header", "footer", "nav"]):
        tag.decompose()

    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    main = (
        soup.select_one("table.bbsView")
        or soup.select_one("#sub_content")
        or soup.select_one(".sub_content_wrap")
        or soup.select_one(".cntnts")
        or soup.select_one(".contents")
        or soup.select_one("#bodyContents")
        or soup.select_one(".bodyContents")
        or soup.select_one("#contents")
        or soup.select_one("#content")
        or soup.find("main")
        or soup.body
        or soup
    )
    lines = [title, main.get_text("\n", strip=True)]
    return normalize_text("\n".join(line for line in lines if line))


def extract_text(path: Path, content_type: str) -> str:
    if path.suffix.lower() == ".pdf" or "pdf" in content_type.lower():
        return extract_pdf(path)
    return extract_html(path)


def paragraph_units(text: str) -> list[str]:
    units = []
    for block in re.split(r"\n\s*\n", text):
        cleaned = normalize_text(block)
        if len(cleaned) >= 20:
            units.append(cleaned)
    if units:
        return units
    return [normalize_text(item) for item in re.split(r"(?<=[.!?。！？])\s+", text) if len(normalize_text(item)) >= 20]


def chunk_text(text: str) -> list[str]:
    chunks: list[str] = []
    current = ""

    for unit in paragraph_units(text):
        if len(current) + len(unit) + 2 <= CHUNK_SIZE:
            current = f"{current}\n\n{unit}".strip()
            continue

        if current:
            chunks.append(current)
            current = current[-CHUNK_OVERLAP:]

        if len(unit) <= CHUNK_SIZE:
            current = f"{current}\n\n{unit}".strip()
            continue

        start = 0
        while start < len(unit):
            chunk = unit[start : start + CHUNK_SIZE]
            chunks.append(chunk)
            start += CHUNK_SIZE - CHUNK_OVERLAP
        current = ""

    if current:
        chunks.append(current)

    return [chunk for chunk in chunks if len(chunk) >= 40]


def token_stream(text: str) -> Iterable[str]:
    lowered = text.lower()
    for token in re.findall(r"[a-z0-9]{2,}|[가-힣]{2,}|[\u4e00-\u9fff\u3040-\u30ffー々〆〤]{2,}", lowered):
        yield token
        if re.fullmatch(r"[가-힣]{3,}", token):
            for size in (2, 3):
                for i in range(0, len(token) - size + 1):
                    yield token[i : i + size]


def vectorize(text: str) -> np.ndarray:
    vector = np.zeros(DIMENSION, dtype=np.float32)
    for token in token_stream(text):
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest, "little") % DIMENSION
        vector[index] += 1.0

    norm = math.sqrt(float(np.dot(vector, vector)))
    if norm > 0:
        vector /= norm
    return vector


def load_sources(path: Path) -> list[Source]:
    raw_sources = json.loads(path.read_text(encoding="utf-8"))
    return [Source(**source) for source in raw_sources]


def build(args: argparse.Namespace) -> None:
    root = server_root()
    sources_path = Path(args.sources) if args.sources else root / "data" / "rag-sources.json"
    output_dir = Path(args.output) if args.output else root / "data" / "rag"
    raw_dir = output_dir / "raw"
    text_dir = output_dir / "texts"
    index_dir = output_dir / "index"

    raw_dir.mkdir(parents=True, exist_ok=True)
    text_dir.mkdir(parents=True, exist_ok=True)
    index_dir.mkdir(parents=True, exist_ok=True)

    sources = load_sources(sources_path)
    documents = []
    chunks = []
    vectors = []

    for source in sources:
        started_at = time.time()
        status = "ok"
        error = ""
        raw_path = ""
        content_type = ""
        text = ""

        try:
            downloaded_path, content_type = fetch_source(source, raw_dir)
            raw_path = str(downloaded_path.relative_to(output_dir))
            text = extract_text(downloaded_path, content_type)
            (text_dir / f"{source.id}.txt").write_text(text, encoding="utf-8")

            for chunk_index, chunk in enumerate(chunk_text(text)):
                chunk_id = f"{source.id}#{chunk_index}"
                chunks.append(
                    {
                        "id": chunk_id,
                        "documentId": source.id,
                        "title": source.title,
                        "source": source.source,
                        "sourceUrl": source.url,
                        "publishedAt": source.publishedAt,
                        "category": source.category,
                        "content": chunk,
                    }
                )
                vectors.append(vectorize(f"{source.title}\n{source.category}\n{chunk}"))
        except Exception as exc:  # noqa: BLE001 - build logs must keep going across sources.
            status = "error"
            error = str(exc)

        documents.append(
            {
                "id": source.id,
                "title": source.title,
                "source": source.source,
                "sourceUrl": source.url,
                "publishedAt": source.publishedAt,
                "category": source.category,
                "rawPath": raw_path,
                "contentType": content_type,
                "textLength": len(text),
                "status": status,
                "error": error,
                "elapsedSeconds": round(time.time() - started_at, 2),
                "host": urlparse(source.url).hostname,
            }
        )
        print(f"{status.upper()} {source.id} {len(text)} chars", flush=True)

    if not vectors:
        raise RuntimeError("No chunks were generated; FAISS index cannot be built.")

    matrix = np.vstack(vectors).astype("float32")
    index = faiss.IndexFlatIP(DIMENSION)
    index.add(matrix)

    index_path = index_dir / "customs.faiss"
    with tempfile.TemporaryDirectory(prefix="customs_faiss_") as temp_dir:
        temp_index_path = Path(temp_dir) / "customs.faiss"
        faiss.write_index(index, str(temp_index_path))
        shutil.copyfile(temp_index_path, index_path)
    (index_dir / "chunks.json").write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")
    (index_dir / "documents.json").write_text(json.dumps(documents, ensure_ascii=False, indent=2), encoding="utf-8")
    (index_dir / "manifest.json").write_text(
        json.dumps(
            {
                "dimension": DIMENSION,
                "chunkCount": len(chunks),
                "documentCount": len(documents),
                "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sources": str(sources_path),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Built FAISS index with {len(chunks)} chunks from {len(documents)} documents.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download customs documents and build a FAISS RAG index.")
    parser.add_argument("--sources", help="Path to rag-sources.json")
    parser.add_argument("--output", help="Output directory for raw files, text, chunks, and FAISS index")
    build(parser.parse_args())


if __name__ == "__main__":
    main()
