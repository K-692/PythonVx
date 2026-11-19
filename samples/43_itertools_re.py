# Title: itertools, functools & re
# Group: Standard library
import itertools
import functools
import re

pairs = list(itertools.combinations("ABC", 2))
total = functools.reduce(lambda a, b: a + b, [1, 2, 3, 4])

text = "Call 555-1234 or 555-9876 today"
phones = re.findall(r"\d{3}-\d{4}", text)
print(pairs, total, phones)
