# Title: Comprehensions & strings
# Group: Data
words = "the quick brown fox".split()
lengths = [len(w) for w in words]
shout = [w.upper() for w in words if len(w) > 3]
initials = "".join(w[0] for w in words)
print(lengths, shout, initials)
