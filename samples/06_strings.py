# Title: Working with text
# Group: Basics
word = "Python"
first = word[0]
last = word[-1]
middle = word[1:4]
shout = word.upper()
count_o = word.count("o")
sentence = "I like " + word
words = sentence.split(" ")
joined = "-".join(words)
print(first, last, middle, shout, count_o)
print(joined)
