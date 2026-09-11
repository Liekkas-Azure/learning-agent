"""Obsidian 兼容 Wiki Markdown 构建（上传/剪藏/监视目录共用）。"""

from __future__ import annotations


def build_obsidian_markdown(
    title: str,
    summary: str,
    tags: list[str],
    ast_data: dict,
    *,
    related_slugs: list[str] | None = None,
    source_url: str = "",
) -> str:
    links = " ".join(f"[[{tag}]]" for tag in tags)
    rel_block = ""
    if related_slugs:
        rel_block = (
            "\n## 相连册页\n"
            + " ".join(f"[[{s}]]" for s in related_slugs)
            + "\n（与本书签条有交集的架上近邻，可双向跳转。）\n"
        )
    source_block = ""
    url = (source_url or "").strip()
    if url:
        source_block = f"\n## 来源\n- [{url}]({url})\n"
    symbols = ast_data.get("symbols", [])
    symbol_lines = "\n".join(
        f"- `{s.get('type')}` {s.get('name')} (line {s.get('line')})" for s in symbols
    )
    return (
        f"# {title}\n\n"
        f"## Summary\n{summary}\n\n"
        f"## Wikilinks\n{links if links else '[[inbox]]'}\n"
        f"{rel_block}"
        f"{source_block}"
        f"\n## Code Symbols\n{symbol_lines if symbol_lines else '- (none)'}\n"
    )
