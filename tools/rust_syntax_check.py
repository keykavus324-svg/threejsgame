#!/usr/bin/env python3
"""Rust sözdizimi denetimi (tree-sitter).

Bu repo derleyici olmadan yazıldığı için her .rs dosyasını tree-sitter
rust grameri ile ayrıştırır ve ERROR/MISSING düğümü varsa hata verir.
Tip/borrown denetimi yapmaz; tek görevi kaba sözdizimi hatalarını yakalamak.

Kullanım: python3 tools/rust_syntax_check.py
Gereksinim: pip install tree-sitter tree-sitter-rust
"""
import sys
from pathlib import Path

try:
    from tree_sitter import Language, Parser
    import tree_sitter_rust
except ImportError as e:
    print(f"[rust-check] tree-sitter yok: {e}")
    print("[rust-check] pip install tree-sitter tree-sitter-rust")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent / "rust"
parser = Parser()
parser.language = Language(tree_sitter_rust.language())

errors = []
checked = 0
for path in sorted(ROOT.rglob("*.rs")):
    source = path.read_bytes()
    tree = parser.parse(source)
    checked += 1

    def walk(node, depth=0):
        problems = []
        if node.type in ("ERROR", "MISSING"):
            problems.append((depth, node.type, node.start_point, node.end_point))
        for child in node.children:
            problems.extend(walk(child, depth + 1))
        return problems

    problems = walk(tree.root_node)
    if tree.root_node.has_error:
        errors.append((path, problems))
        print(f"[rust-check] FAIL {path.relative_to(ROOT.parent)}")
        for depth, kind, start, end in problems[:20]:
            print(f"    {kind:<8} satır {start[0] + 1}:{start[1] + 1} → {end[0] + 1}:{end[1] + 1}")
    else:
        print(f"[rust-check] ok   {path.relative_to(ROOT.parent)}")

print()
print(f"[rust-check] {checked} dosya denetlendi, {len(errors)} sorunlu")
sys.exit(1 if errors else 0)
