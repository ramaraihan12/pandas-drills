"""Every reference solution passes its check, and every wrong answer fails with a friendly message."""
import json
from pathlib import Path

import pytest

import drills

ROOT = Path(__file__).resolve().parent.parent
EX_DIR = ROOT / "exercises"
DATA_DIR = EX_DIR / "data"
FOLDERS = sorted(p for p in EX_DIR.iterdir() if p.is_dir() and p.name != "data")


def front_matter(text):
    head, _, body = text.partition("\n---\n")
    meta = {}
    for line in head.splitlines()[1:]:
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta, body.strip()


def load(folder):
    meta, _ = front_matter((folder / "prompt.md").read_text(encoding="utf-8"))
    names = [n.strip() for n in meta["data"].split(",")]
    data = {n: (DATA_DIR / n).read_text(encoding="utf-8") for n in names}
    return meta, data


def grade(folder, code, mode="check"):
    _, data = load(folder)
    raw = drills.run(code, data, (folder / "solution.py").read_text(encoding="utf-8"),
                     (folder / "check.py").read_text(encoding="utf-8"), mode)
    return json.loads(raw)


def test_there_are_fifteen_exercises():
    assert len(FOLDERS) == 15


@pytest.mark.parametrize("folder", FOLDERS, ids=lambda p: p.name)
def test_solution_passes(folder):
    res = grade(folder, (folder / "solution.py").read_text(encoding="utf-8"))
    assert res["passed"], res


@pytest.mark.parametrize("folder", FOLDERS, ids=lambda p: p.name)
def test_starter_does_not_pass(folder):
    res = grade(folder, (folder / "starter.py").read_text(encoding="utf-8"))
    assert not res["passed"]


WRONG = [(f, w) for f in FOLDERS for w in sorted(f.glob("wrong_*.py"))]


@pytest.mark.parametrize("folder", FOLDERS, ids=lambda p: p.name)
def test_at_least_two_wrong_answers(folder):
    assert len(list(folder.glob("wrong_*.py"))) >= 2


@pytest.mark.parametrize("folder,wrong", WRONG, ids=lambda x: x.name)
def test_wrong_answer_fails_with_friendly_message(folder, wrong):
    first, _, code = wrong.read_text(encoding="utf-8").partition("\n")
    assert first.startswith("# expect:")
    expect = first.split(":", 1)[1].strip().lower()
    res = grade(folder, code)
    assert not res["passed"], f"{wrong.name} should not pass"
    if res["kind"] == "exception":
        text = json.dumps(res["error"]).lower()
    else:
        text = res["message"].lower()
    assert expect in text, f"{wrong.name}: expected {expect!r} in {text!r}"
    assert "traceback" not in text


def test_every_exercise_has_front_matter_and_files():
    for f in FOLDERS:
        meta, _ = load(f)
        assert meta["id"] == f.name
        assert meta["difficulty"] in ("easy", "medium")
        for name in ("prompt.md", "starter.py", "solution.py", "check.py"):
            assert (f / name).exists()
