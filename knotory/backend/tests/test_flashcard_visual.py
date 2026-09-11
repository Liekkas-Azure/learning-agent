from app.flashcard_visual import heuristic_mermaid, sanitize_mermaid, visual_bundle_for_card


def test_sanitize_mermaid_accepts_mindmap():
    code = "mindmap\n  root((主题))\n    要点A\n    要点B"
    out = sanitize_mermaid(code)
    assert out is not None
    assert out.startswith("mindmap")
    assert '"要点A"' in out
    assert '"要点B"' in out


def test_sanitize_mermaid_rejects_script():
    assert sanitize_mermaid("```js\nalert(1)\n```") is None


def test_sanitize_mermaid_strips_fence_and_quotes_mindmap_nodes():
    raw = "```mermaid\nmindmap\n  root((主题))\n    要点A\n```"
    out = sanitize_mermaid(raw)
    assert out is not None
    assert out.startswith("mindmap")
    assert '"要点A"' in out


def test_visual_bundle_fallback_mermaid():
    bundle = visual_bundle_for_card(
        topic="因果推断",
        topics=["因果推断", "uplift"],
        section_title="能力特点",
    )
    assert bundle["visual_palette"]
    assert bundle["visual_emoji"]
    assert bundle["visual_mermaid"]
    assert "mindmap" in bundle["visual_mermaid"]


def test_heuristic_mermaid():
    m = heuristic_mermaid(title="测试章节", topics=["A", "B"])
    assert m and "mindmap" in m
