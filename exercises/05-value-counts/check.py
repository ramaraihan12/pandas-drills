from drills import compare


def check(result, expected):
    return compare(result, expected, ignore_order=False)
