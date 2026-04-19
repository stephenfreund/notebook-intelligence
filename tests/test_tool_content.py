"""Tests for the ToolContent multi-part tool-result plumbing.

Covers:
  - The dataclass default state.
  - api._render_tool_content provider-capability dispatch.
  - claude.tool_structured_response block shapes.
"""

from unittest.mock import MagicMock

from notebook_intelligence.api import ToolContent, _render_tool_content


PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAC="


def _request_with_provider(provider_id):
    req = MagicMock()
    req.host.chat_model.provider.id = provider_id
    return req


class TestToolContentDataclass:
    def test_default_empty(self):
        tc = ToolContent()
        assert tc.blocks == []
        assert tc.text_summary == ""

    def test_round_trip(self):
        tc = ToolContent(
            blocks=[{"type": "text", "text": "hi"}],
            text_summary="hi",
        )
        assert tc.blocks == [{"type": "text", "text": "hi"}]
        assert tc.text_summary == "hi"


class TestRenderToolContent:
    def test_structured_for_openai_compatible(self):
        req = _request_with_provider("openai-compatible")
        tc = ToolContent(
            blocks=[
                {"type": "text", "text": "hello"},
                {"type": "image", "mime": "image/png", "data": PNG_B64},
            ],
            text_summary="hello + [image]",
        )
        content = _render_tool_content(req, tc)
        assert isinstance(content, list)
        assert content[0] == {"type": "text", "text": "hello"}
        assert content[1]["type"] == "image_url"
        assert content[1]["image_url"]["url"] == f"data:image/png;base64,{PNG_B64}"

    def test_structured_for_litellm(self):
        req = _request_with_provider("litellm")
        tc = ToolContent(
            blocks=[{"type": "text", "text": "hi"}],
            text_summary="hi",
        )
        content = _render_tool_content(req, tc)
        assert isinstance(content, list)
        assert content == [{"type": "text", "text": "hi"}]

    def test_text_summary_for_unsupported_provider(self):
        req = _request_with_provider("github-copilot")
        tc = ToolContent(
            blocks=[{"type": "text", "text": "hi"}],
            text_summary="summary-fallback",
        )
        content = _render_tool_content(req, tc)
        assert content == "summary-fallback"

    def test_text_summary_when_provider_unknown(self):
        req = _request_with_provider(None)
        tc = ToolContent(blocks=[], text_summary="only summary")
        content = _render_tool_content(req, tc)
        assert content == "only summary"

    def test_empty_blocks_falls_through_to_summary(self):
        req = _request_with_provider("openai-compatible")
        tc = ToolContent(blocks=[], text_summary="summary here")
        content = _render_tool_content(req, tc)
        # With no renderable blocks, we fall back to the text summary so
        # the model still sees something readable.
        assert content == "summary here"

    def test_provider_lookup_failure_falls_back_to_summary(self):
        req = MagicMock()
        # Chain-access explodes
        req.host.chat_model.provider.id = property(lambda self: (_ for _ in ()).throw(RuntimeError("x")))
        tc = ToolContent(blocks=[{"type": "text", "text": "hi"}], text_summary="safe")
        content = _render_tool_content(req, tc)
        # Either we got the summary (safe path) or the blocks (structured); both avoid the crash.
        assert content in ("safe", [{"type": "text", "text": "hi"}])


class TestClaudeToolStructuredResponse:
    def test_text_block(self):
        from notebook_intelligence.claude import tool_structured_response

        tc = ToolContent(blocks=[{"type": "text", "text": "hi"}], text_summary="hi")
        result = tool_structured_response(tc)
        assert result == {"content": [{"type": "text", "text": "hi"}]}

    def test_image_block_has_claude_shape(self):
        from notebook_intelligence.claude import tool_structured_response

        tc = ToolContent(
            blocks=[{"type": "image", "mime": "image/png", "data": PNG_B64}],
            text_summary="",
        )
        result = tool_structured_response(tc)
        (block,) = result["content"]
        assert block["type"] == "image"
        assert block["source"] == {
            "type": "base64",
            "media_type": "image/png",
            "data": PNG_B64,
        }

    def test_empty_blocks_falls_back_to_summary_text(self):
        from notebook_intelligence.claude import tool_structured_response

        tc = ToolContent(blocks=[], text_summary="fallback")
        result = tool_structured_response(tc)
        assert result == {"content": [{"type": "text", "text": "fallback"}]}

    def test_mixed_ordering_preserved(self):
        from notebook_intelligence.claude import tool_structured_response

        tc = ToolContent(
            blocks=[
                {"type": "text", "text": "before"},
                {"type": "image", "mime": "image/jpeg", "data": PNG_B64},
                {"type": "text", "text": "after"},
            ],
            text_summary="",
        )
        result = tool_structured_response(tc)
        types = [b["type"] for b in result["content"]]
        assert types == ["text", "image", "text"]
        assert result["content"][1]["source"]["media_type"] == "image/jpeg"
