# Title: Searching a list
# Group: Data
def find(items, target):
    for index, value in enumerate(items):
        if value == target:
            return index
    return -1

scores = [42, 17, 99, 63]
position = find(scores, 99)
missing = find(scores, 5)
print(position, missing)
