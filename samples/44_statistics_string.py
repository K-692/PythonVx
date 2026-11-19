# Title: statistics & string
# Group: Standard library
import statistics
import string

marks = [72, 85, 90, 66, 85]
average = statistics.mean(marks)
middle = statistics.median(marks)
common = statistics.mode(marks)

letters = string.ascii_lowercase[:5]
title = string.capwords("hello python world")
print(average, middle, common, letters, title)
