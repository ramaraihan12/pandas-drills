from drills import compare


def check(result, expected):
    # fillna(0) turns the counts into floats; the numbers are what matters here
    return compare(result, expected, check_index=True, check_dtype=False)
