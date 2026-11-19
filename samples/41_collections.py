# Title: collections
# Group: Standard library
from collections import Counter, deque, defaultdict, namedtuple

letters = Counter("mississippi")
print(letters.most_common(2))

queue = deque([1, 2, 3])
queue.appendleft(0)
queue.pop()

groups = defaultdict(list)
for word in ["apple", "avocado", "banana", "blueberry"]:
    groups[word[0]].append(word)

Point = namedtuple("Point", "x y")
p = Point(3, 4)
print(queue, dict(groups), p.x + p.y)
