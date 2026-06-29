from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import tempfile
from pathlib import Path

import faiss
import numpy as np


DIMENSION = 4096

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def server_root() -> Path:
    return Path(__file__).resolve().parents[1]


def token_stream(text: str):
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
    return vector.reshape(1, -1)


def snippet(content: str, max_length: int = 420) -> str:
    cleaned = re.sub(r"\s+", " ", content).strip()
    if len(cleaned) <= max_length:
        return cleaned
    return f"{cleaned[:max_length].rstrip()}..."


def search(args: argparse.Namespace) -> None:
    index_dir = Path(args.index_dir) if args.index_dir else server_root() / "data" / "rag" / "index"
    index_path = index_dir / "customs.faiss"
    chunks_path = index_dir / "chunks.json"

    if not index_path.exists() or not chunks_path.exists():
        print(json.dumps({"results": [], "error": "FAISS index files not found"}, ensure_ascii=False))
        return

    with tempfile.TemporaryDirectory(prefix="customs_faiss_") as temp_dir:
        temp_index_path = Path(temp_dir) / "customs.faiss"
        shutil.copyfile(index_path, temp_index_path)
        index = faiss.read_index(str(temp_index_path))
    chunks = json.loads(chunks_path.read_text(encoding="utf-8"))
    query_vector = vectorize(args.query)
    scores, indexes = index.search(query_vector, max(1, args.limit))

    results = []
    for score, chunk_index in zip(scores[0], indexes[0]):
        if chunk_index < 0 or chunk_index >= len(chunks):
            continue
        chunk = chunks[chunk_index]
        results.append(
            {
                "id": chunk["id"],
                "title": chunk["title"],
                "source": chunk["source"],
                "sourceUrl": chunk.get("sourceUrl"),
                "publishedAt": chunk.get("publishedAt"),
                "category": chunk.get("category"),
                "snippet": snippet(chunk["content"]),
                "score": float(score),
            }
        )

    print(json.dumps({"results": results}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Search the local customs FAISS index.")
    parser.add_argument("--query", required=True)
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--index-dir")
    search(parser.parse_args())


if __name__ == "__main__":
    main()
