from drills import compare


def check(result, expected):
    return compare(result, expected, check_index=True)
