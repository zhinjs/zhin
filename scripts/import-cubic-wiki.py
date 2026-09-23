#!/usr/bin/env python3
"""Import the public Cubic Wiki Markdown embedded in its server-rendered page.

Usage: python3 scripts/import-cubic-wiki.py [--html saved-page.html]

The Flight payload format is owned by Cubic. Fail closed if its shape or page
count changes, so a refresh cannot silently publish a partial knowledge base.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


SOURCE_URL = "https://www.cubic.dev/wikis/zhinjs/zhin"
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "docs/en/wiki/cubic"
MANIFEST_FILE = Path(__file__).resolve().parents[1] / "docs/public/wiki/cubic/source.json"
EXPECTED_PAGE_COUNT = 29
SCRIPT_RE = re.compile(r'<script>self\.__next_f\.push\(\[1,(".*?")\]\)</script>', re.S)
TEXT_RE = re.compile(rb"([0-9a-f]+):T([0-9a-f]+),")
PAGE_RE = re.compile(
    r'\{"id":"(page-[^"]+)","title":"([^"]+)","content":"\$([0-9a-f]+)"'
)
COMMIT_RE = re.compile(r'"source_commit_sha":"([0-9a-f]{40})"')
CORRECTIONS = {
    "quickstart": (
        "New projects created with `create-zhin-app` require Node.js `>=22.12.0` and "
        "currently configure HTTP port `8068`. The broader `zhin.js` library engine range "
        "does not describe the generated TypeScript project's requirement. "
        "See [Getting Started](/en/getting-started/)."
    ),
    "plugin-runtime": (
        "Code capabilities use named directories with fixed `index.ts` entries: "
        "`commands/**/index.ts` and one-level `handlers/<name>/index.ts`. "
        "The file-style examples in the snapshot are not discovered. "
        "See [Convention Directories](/en/authoring/conventions)."
    ),
    "commands": (
        "Commands use route directories ending in `index.ts`; Handlers use one named directory, "
        "such as `handlers/message-receive/index.ts` with an explicit `event: 'message.receive'`. "
        "The nested Handler file example below is unsupported. "
        "See [Convention Directories](/en/authoring/conventions)."
    ),
    "mcp": (
        "The current Runtime Host registers **Tools only** and is mounted only with an explicit "
        "top-level `mcp:` configuration. `ai.mcpServers` configures the separate Agent MCP client. "
        "The generator, Resource, Prompt, and default-enabled server descriptions below are stale. "
        "See [the Host implementation](https://github.com/zhinjs/zhin/blob/main/packages/host/mcp/src/runtime.ts) "
        "and [the MCP documentation correction](https://github.com/zhinjs/zhin/pull/684)."
    ),
    "security-sandbox": (
        "`execApprovalMode` is `ask | auto | bypass`. A Tool's separate `requiresApproval` is "
        "`never | on-risk | once | always`; these are not interchangeable. "
        "The approval-mode table below is stale. See [Agent configuration](/en/ai/) "
        "and [Tool authoring](/en/authoring/agent-tools)."
    ),
    "security-policy": (
        "New scaffolded projects currently configure HTTP port `8068`; `8086` is the fallback "
        "when the runtime has no configured port. Check the startup output or `http.port`. "
        "See [Getting Started](/en/getting-started/)."
    ),
    "docker-prod": (
        "The `8086` proxy example below applies only when that port is configured or the runtime "
        "uses its unconfigured fallback. New scaffolded projects use `8068`. "
        "See [Production Deployment](/en/operations/production)."
    ),
}


def extract_pages(html: str) -> tuple[str, list[dict[str, str]]]:
    chunks = [json.loads(match.group(1)) for match in SCRIPT_RE.finditer(html)]
    if not chunks:
        raise ValueError("Cubic Flight payload not found")
    flight = "".join(chunks)
    data = flight.encode("utf-8")

    contents: dict[str, str] = {}
    for match in TEXT_RE.finditer(data):
        size = int(match.group(2), 16)
        body = data[match.end() : match.end() + size]
        if len(body) != size:
            raise ValueError(f"Truncated Flight text record {match.group(1)!r}")
        contents[match.group(1).decode("ascii")] = body.decode("utf-8")

    commits = set(COMMIT_RE.findall(flight))
    if len(commits) != 1:
        raise ValueError(f"Expected one source commit, found {len(commits)}")
    commit = commits.pop()

    pages: dict[str, dict[str, str]] = {}
    for match in PAGE_RE.finditer(flight):
        page_id, title, content_id = match.groups()
        body = contents.get(content_id)
        if body is None or not re.search(r"(?m)^#\s+", body):
            raise ValueError(f"Missing Markdown body for {page_id}")
        page = {"id": page_id, "title": title, "body": body}
        if page_id in pages and pages[page_id] != page:
            raise ValueError(f"Conflicting duplicate page: {page_id}")
        pages[page_id] = page

    if len(pages) != EXPECTED_PAGE_COUNT:
        raise ValueError(f"Expected {EXPECTED_PAGE_COUNT} pages, found {len(pages)}")
    return commit, list(pages.values())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Use a saved Cubic HTML page instead of downloading")
    args = parser.parse_args()

    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        request = Request(f"{SOURCE_URL}?page=page-intro", headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8")

    commit, pages = extract_pages(html)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest = {
        "source": SOURCE_URL,
        "source_commit": commit,
        "captured_at": captured_at,
        "pages": [],
    }

    for page in pages:
        slug = page["id"].removeprefix("page-")
        source_page = f"{SOURCE_URL}?page={page['id']}"
        # Normalize only whitespace at line ends; keep the raw hash in the manifest.
        body = "\n".join(line.rstrip() for line in page["body"].splitlines()).rstrip() + "\n"
        correction = (
            f"::: danger Known correction\n{CORRECTIONS[slug]}\n:::\n\n"
            if slug in CORRECTIONS
            else ""
        )
        markdown = (
            f"---\ntitle: {json.dumps(page['title'], ensure_ascii=False)}\n---\n\n"
            "::: warning Generated reference snapshot\n"
            f"[Original Cubic page]({source_page}) · captured {captured_at[:10]} · "
            f"[source commit](https://github.com/zhinjs/zhin/commit/{commit}). "
            "This AI-generated page has not been verified against the current code. "
            "Use the [Zhin documentation](/en/getting-started/) for current behavior and "
            "[see known corrections](/en/wiki/).\n"
            ":::\n\n"
            + correction
            + body
        )
        filename = f"{slug}.md"
        (OUTPUT_DIR / filename).write_text(markdown, encoding="utf-8")
        manifest["pages"].append(
            {
                "id": page["id"],
                "title": page["title"],
                "file": filename,
                "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                "source_body_sha256": hashlib.sha256(page["body"].encode("utf-8")).hexdigest(),
            }
        )

    MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Imported {len(pages)} Cubic Wiki pages from {commit} into {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
