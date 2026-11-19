# Title: Sets & tuples
# Group: Data
point = (3, 4)
x, y = point
colors = {"red", "green"}
colors.add("blue")
colors.add("red")          # already there: sets have no duplicates
warm = {"red", "orange"}
both = colors & warm
print(x, y, sorted(colors), both)
