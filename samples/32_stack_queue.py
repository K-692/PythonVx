# Title: Stack & queue class
# Group: Classes
class Stack:
    def __init__(self):
        self.items = []

    def push(self, item):
        self.items.append(item)

    def pop(self):
        return self.items.pop()

s = Stack()
s.push("a")
s.push("b")
s.push("c")
top = s.pop()
print(top, s.items)
