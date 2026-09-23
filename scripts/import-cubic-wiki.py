#!/usr/bin/env python3
"""Import the public Cubic Wiki Markdown embedded in its server-rendered page.

Usage: python3 scripts/import-cubic-wiki.py [--html saved-page.html]
       python3 scripts/import-cubic-wiki.py --verify

The Flight payload format is owned by Cubic. Fail closed if its shape or page
count changes, so a refresh cannot silently publish a partial knowledge base.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


SOURCE_URL = "https://www.cubic.dev/wikis/zhinjs/zhin"
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "docs/en/wiki/cubic"
MANIFEST_FILE = Path(__file__).resolve().parents[1] / "docs/public/wiki/cubic/source.json"
EXPECTED_SLUGS = frozenset(
    """intro quickstart arch-core plugin-runtime message-flow hmr-generation
    commands messaging database scheduling logging ai-orchestration ai-providers
    tools-caps skills memory security-sandbox mcp adapters-core adapters-platforms
    satori speech console-arch console-pages config docker-prod security-policy
    cli-tools testing""".split()
)
SCRIPT_RE = re.compile(r'<script>self\.__next_f\.push\(\[1,(".*?")\]\)</script>', re.S)
TEXT_RE = re.compile(rb"([0-9a-f]+):T([0-9a-f]+),")
SAFE_SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
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
        "when the runtime has no configured port. Built-in Agent defaults are `execSecurity: deny` "
        "and `execApprovalMode: auto`; explicit project configuration may override them. "
        "Check the startup output or `http.port`. "
        "See [Getting Started](/en/getting-started/)."
    ),
    "docker-prod": (
        "The `8086` proxy example below applies only when that port is configured or the runtime "
        "uses its unconfigured fallback. New scaffolded projects use `8068`; `pnpm daemon` "
        "and `pnpm stop` are legacy migration scripts, not new-scaffold defaults. "
        "Some Cubic source line anchors in this article point to unrelated content. "
        "See [Production Deployment](/en/operations/production)."
    ),
    "config": (
        "`zhin migrate` updates package metadata, directories, bootstrap files, and dependencies; "
        "it does **not** rewrite `bots:` into `endpoints:` in `zhin.config.yml`. "
        "Migrate that configuration manually. See [Configuration](/en/configuration/)."
    ),
    "ai-orchestration": (
        "Tools and Hooks use `tools/<name>/index.ts` and `hooks/<name>/index.ts`. "
        "`execSecurity` (`deny | allowlist | full`) and `execApprovalMode` (`ask | auto | bypass`) "
        "are separate settings. See [Convention Directories](/en/authoring/conventions) "
        "and [Agent configuration](/en/ai/)."
    ),
    "adapters-core": (
        "The lifecycle diagram below conflates a scaffolded Endpoint example with "
        "`createEndpointLifecycle`. The latter uses `idle / connecting / open / reconnecting / "
        "closed / stopped` and does not expose the diagram's `open()` / `close()` transitions. "
        "The example does not compile: `Endpoint` takes no constructor arguments and its "
        "abstract `open()` / `close()` methods are not implemented. It is only a partial "
        "skeleton, not a copy-ready inbound adapter. "
        "See [Endpoint Lifecycle](/en/authoring/endpoint-lifecycle)."
    ),
    "satori": (
        "The `wrapCardHtml` example below requires a background color argument; the normalized "
        "copy supplies `DEFAULT_CARD_THEME.canvas`. See [the maintained card example]"
        "(/en/authoring/middleware-components)."
    ),
    "messaging": (
        "The example below uses `raw` from `zhin.js/core/runtime`, which wraps outbound content. "
        "The distinct `segment.raw` utility formats a preview string. The utility table in the "
        "Cubic original used incorrect parameter types; this copy corrects them. "
        "See [Middleware and Components](/en/authoring/middleware-components)."
    ),
    "speech": (
        "Some source citation line anchors in the Cubic original point to unrelated lines at "
        "the pinned commit. Check the linked file rather than relying on its line range. "
        "See [Speech](/en/ai/speech)."
    ),
    "scheduling": (
        "Some Cubic source line anchors for the plugin example point to unrelated blocks. "
        "Check the linked files before copying the example. See [Schedules](/en/authoring/define-plugin)."
    ),
}

# Minimal editorial repairs are applied after preserving the raw source hash.
BODY_REPLACEMENTS: dict[str, tuple[tuple[str, str], ...]] = {
    "quickstart": ((
        "Versions `^20.19.0` or `>=22.12.0` (required for TypeScript projects).",
        "`>=22.12.0` for projects generated with `create-zhin-app`.",
    ),),
    "config": ((
        "Migrates the legacy `bots:` configuration block to the modern `endpoints:` structure.",
        "Does not rewrite legacy `bots:` configuration; update it manually to `endpoints:`.",
    ),),
    "ai-orchestration": (
        ("`tools/*.ts`", "`tools/<name>/index.ts`"),
        ("`hooks/*.ts`", "`hooks/<name>/index.ts`"),
        ("Supports `allowlist` and `ask` modes (ExecApprovalMode).",
         "Separates `execSecurity` (`deny | allowlist | full`) from `execApprovalMode` (`ask | auto | bypass`)."),
    ),
    "security-policy": (
        ("32-bit hex string", "32-character hex string"),
        ("`execSecurity`: Set to `allowlist`.", "`execSecurity`: Defaults to `deny`."),
        ("`execApprovalMode`: Set to `ask`.", "`execApprovalMode`: Defaults to `auto`."),
    ),
    "satori": (
        ("h, wrapCardHtml } from '@zhin.js/satori'", "h, wrapCardHtml, DEFAULT_CARD_THEME } from '@zhin.js/satori'"),
        ("wrapCardHtml(body)", "wrapCardHtml(body, DEFAULT_CARD_THEME.canvas)"),
    ),
    "messaging": (
        ("```typescript\nexport default defineComponent<StatusCardProps>",
         "```typescript\nimport { raw } from 'zhin.js/core/runtime';\n\nexport default defineComponent<StatusCardProps>"),
        ("| `from(template)` | `string` | `Segment[]` |", "| `segment.from(content)` | `SendContent` | `SendContent` |"),
        ("| `raw(content)` | `Segment[]` | `string` |", "| `segment.raw(content)` | `SendContent` | `string` |"),
        ("| `text(content)` |", "| `segment.text(content)` |"),
        ("| `face(id, alt?)` |", "| `segment.face(id, text?)` |"),
        ("| `escape(text)` |", "| `segment.escape(text)` |"),
    ),
    "docker-prod": (
        ("| `pnpm daemon` |", "| `pnpm daemon` (migrated legacy projects only) |"),
        ("| `pnpm stop` |", "| `pnpm stop` (migrated legacy projects only) |"),
    ),
    "database": (("configuration向导 (wizard)", "configuration wizard"),),
    "console-pages": ((
        "/packages/cli/src/plugin-runtime/console/page-renderer.ts",
        "/basic/cli/src/plugin-runtime/console/page-renderer.ts",
    ),),
    "logging": (("addGlobalTransport", "addTransport"),),
    "adapters-platforms": (("it admit the data", "it admits the data"),),
}


def extract_pages(html: str) -> tuple[str, list[dict[str, str]]]:
    chunks = [json.loads(match.group(1)) for match in SCRIPT_RE.finditer(html)]
    if not chunks:
        raise ValueError("Cubic Flight payload not found")
    flight = "".join(chunks)
    data = flight.encode("utf-8")

    contents: dict[str, str] = {}
    cursor = 0
    while match := TEXT_RE.search(data, cursor):
        size = int(match.group(2), 16)
        body = data[match.end() : match.end() + size]
        if len(body) != size:
            raise ValueError(f"Truncated Flight text record {match.group(1)!r}")
        contents[match.group(1).decode("ascii")] = body.decode("utf-8")
        cursor = match.end() + size

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

    expected_ids = {f"page-{slug}" for slug in EXPECTED_SLUGS}
    if set(pages) != expected_ids:
        raise ValueError(
            f"Unexpected page IDs: missing={sorted(expected_ids - pages.keys())}, "
            f"extra={sorted(pages.keys() - expected_ids)}"
        )
    return commit, list(pages.values())


def normalized_body(slug: str, source_body: str) -> str:
    """Convert the known source-files wrapper and reject other raw HTML."""
    opening = "<details>\n<summary>Relevant source files</summary>\n"
    if not source_body.startswith(opening) or source_body.count("</details>") != 1:
        raise ValueError(f"Unexpected source-files wrapper in {slug}")
    body = source_body.replace(opening, "::: details Relevant source files\n", 1)
    body = body.replace("</details>", ":::", 1)

    for old, new in BODY_REPLACEMENTS.get(slug, ()):
        if old not in body:
            raise ValueError(f"Editorial replacement no longer matches {slug}: {old}")
        body = body.replace(old, new)

    in_fence = False
    for line in body.splitlines():
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        without_inline_code = re.sub(r"`[^`]*`", "", line)
        if re.search(r"</?[A-Za-z][^>]*>", without_inline_code):
            raise ValueError(f"Raw HTML requires manual review in {slug}: {line[:80]}")
    if in_fence:
        raise ValueError(f"Unclosed code fence in {slug}")
    return "\n".join(line.rstrip() for line in body.splitlines()).rstrip() + "\n"


def verify_snapshot() -> None:
    """Check every published Markdown body against the manifest hash."""
    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    pages = manifest["pages"]
    expected_files = {f"{slug}.md" for slug in EXPECTED_SLUGS}
    actual_files = {path.name for path in OUTPUT_DIR.glob("*.md")}
    if actual_files != expected_files or {page["file"] for page in pages} != expected_files:
        raise ValueError("Wiki articles and manifest do not match the expected page set")
    marker = "\n::: details Relevant source files\n"
    for page in pages:
        markdown = (OUTPUT_DIR / page["file"]).read_text(encoding="utf-8")
        if markdown.count(marker) != 1:
            raise ValueError(f"Missing body marker in {page['file']}")
        body = "::: details Relevant source files\n" + markdown.split(marker, 1)[1]
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        if digest != page["body_sha256"]:
            raise ValueError(f"Body hash mismatch in {page['file']}")
    print(f"Verified {len(pages)} Wiki articles against {MANIFEST_FILE}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Use a saved Cubic HTML page instead of downloading")
    parser.add_argument("--verify", action="store_true", help="Verify the committed snapshot offline")
    args = parser.parse_args()

    if args.verify:
        verify_snapshot()
        return

    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        request = Request(f"{SOURCE_URL}?page=page-intro", headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8")

    commit, pages = extract_pages(html)
    expected_files = {f"{slug}.md" for slug in EXPECTED_SLUGS}
    existing_files = {path.name for path in OUTPUT_DIR.iterdir()} if OUTPUT_DIR.exists() else set()
    unexpected_files = existing_files - expected_files
    if unexpected_files:
        raise ValueError(f"Unexpected existing Wiki articles: {sorted(unexpected_files)}")
    captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rendered: dict[str, str] = {}
    manifest = {
        "source": SOURCE_URL,
        "source_commit": commit,
        "captured_at": captured_at,
        "body_hash_scope": "Complete normalized Cubic Markdown from the source-files details block onward, excluding frontmatter and warning/correction banners",
        "pages": [],
    }

    for page in pages:
        slug = page["id"].removeprefix("page-")
        if not SAFE_SLUG_RE.fullmatch(slug) or slug not in EXPECTED_SLUGS:
            raise ValueError(f"Unsafe or unexpected page slug: {slug}")
        source_page = f"{SOURCE_URL}?page={page['id']}"
        body = normalized_body(slug, page["body"])
        correction = (
            f"::: danger Known correction\n{CORRECTIONS[slug]}\n:::\n\n"
            if slug in CORRECTIONS
            else ""
        )
        markdown = (
            f"---\ntitle: {json.dumps(page['title'], ensure_ascii=False)}\n---\n\n"
            f"[中文版](/wiki/cubic/{slug})\n\n"
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
        rendered[filename] = markdown
        manifest["pages"].append(
            {
                "id": page["id"],
                "title": page["title"],
                "file": filename,
                "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                "source_body_sha256": hashlib.sha256(page["body"].encode("utf-8")).hexdigest(),
            }
        )

    # Validate every article before touching the published snapshot. Stage all
    # files first; if replacing the manifest fails, restore the previous set.
    if set(rendered) != expected_files:
        raise ValueError("Rendered Wiki article set does not match the expected page set")
    OUTPUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".cubic-wiki-", dir=OUTPUT_DIR.parent) as temp:
        temporary = Path(temp)
        staged_pages = temporary / "pages"
        staged_pages.mkdir()
        for filename, markdown in rendered.items():
            (staged_pages / filename).write_text(markdown, encoding="utf-8")
        staged_manifest = temporary / "source.json"
        staged_manifest.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        previous_pages = temporary / "previous-pages"
        had_previous = OUTPUT_DIR.exists()
        if had_previous:
            OUTPUT_DIR.rename(previous_pages)
        try:
            staged_pages.rename(OUTPUT_DIR)
            os.replace(staged_manifest, MANIFEST_FILE)
        except Exception:
            if OUTPUT_DIR.exists():
                shutil.rmtree(OUTPUT_DIR)
            if had_previous:
                previous_pages.rename(OUTPUT_DIR)
            raise
    print(f"Imported {len(pages)} Cubic Wiki pages from {commit} into {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
