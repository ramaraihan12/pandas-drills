from drills import compare


def check(result, expected):
    return compare(result, expected, sort_by=["channel"])
