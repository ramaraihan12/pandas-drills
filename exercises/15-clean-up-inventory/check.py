from drills import Problem, compare


def check(result, expected):
    problem = compare(result, expected)
    if problem is None and list(result.index) != list(range(len(result))):
        return Problem("wrong_index", "Number the rows 0, 1, 2 ... again with reset_index(drop=True).")
    return problem
