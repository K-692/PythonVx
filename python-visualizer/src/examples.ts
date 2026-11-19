export interface Example {
  id: string;
  title: string;
  group: 'Basics' | 'Functions' | 'Data' | 'Classes' | 'Standard library';
  code: string;
  stdin?: string;
}

const ex = (id: string, title: string, group: Example['group'], code: string, stdin?: string): Example => ({
  id,
  title,
  group,
  code: code.replace(/^\n/, ''),
  stdin,
});

export const EXAMPLES: Example[] = [
  ex('hello', 'Variables & printing', 'Basics', `
# A variable is a name that points to a value.
name = "Ada"
age = 36
age = age + 1          # read the old value, add 1, store it again

greeting = "Hello, " + name + "!"
print(greeting)
print(name, "is", age, "years old")
`),
  ex('if', 'Making decisions (if / else)', 'Basics', `
temperature = 23

if temperature > 30:
    advice = "Stay inside, it's hot!"
elif temperature > 15:
    advice = "Nice weather for a walk."
else:
    advice = "Bring a jacket."

print(advice)
`),
  ex('loops', 'Loops (for / while)', 'Basics', `
# Add up the numbers 1 to 5
total = 0
for n in range(1, 6):
    total = total + n
print("Sum:", total)

# Count down with a while loop
count = 3
while count > 0:
    print(count, "...")
    count -= 1
print("Lift off!")
`),
  ex('input', 'Reading input', 'Basics', `
# Type the answers into the "Program input" box, one per line.
name = input("What is your name? ")
year = int(input("What year were you born? "))
age = 2026 - year
print(f"Hi {name}, you are about {age} years old.")
`, 'Grace\n1990\n'),
  ex('functions', 'Functions', 'Functions', `
def area(width, height):
    result = width * height
    return result

def describe(w, h):
    a = area(w, h)
    return f"A {w}x{h} rectangle has area {a}"

print(describe(3, 4))
print(describe(5, 2))
`),
  ex('recursion', 'Recursion (factorial)', 'Functions', `
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(4))
`),
  ex('scope', 'Scope & default arguments', 'Functions', `
counter = 0

def bump(step=1):
    global counter
    counter += step
    return counter

bump()
bump(5)
print("counter is", counter)
`),
  ex('lists', 'Lists', 'Data', `
fruits = ["apple", "banana"]
fruits.append("cherry")
fruits.insert(0, "mango")
first = fruits[0]
fruits.remove("banana")

basket = fruits            # NOT a copy: two names, one list
basket.append("kiwi")      # ...so 'fruits' changes too!
copy = list(fruits)        # a real copy

print(fruits)
print(len(copy), first)
`),
  ex('dicts', 'Dictionaries', 'Data', `
ages = {"ann": 31, "bob": 27}
ages["cara"] = 22
ages["bob"] += 1

for name, age in ages.items():
    print(name, "is", age)

oldest = max(ages, key=ages.get)
print("Oldest:", oldest)
`),
  ex('sorting', 'Bubble sort', 'Data', `
nums = [5, 2, 9, 1, 6]

for i in range(len(nums)):
    for j in range(len(nums) - 1 - i):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]

print(nums)
`),
  ex('comprehension', 'Comprehensions & strings', 'Data', `
words = "the quick brown fox".split()
lengths = [len(w) for w in words]
shout = [w.upper() for w in words if len(w) > 3]
initials = "".join(w[0] for w in words)
print(lengths, shout, initials)
`),
  ex('classes', 'Classes & objects', 'Classes', `
class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def deposit(self, amount):
        self.balance += amount
        return self.balance

    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError("Not enough money!")
        self.balance -= amount
        return self.balance

acct = BankAccount("Ada", 100)
acct.deposit(50)
acct.withdraw(30)
print(acct.owner, "has", acct.balance)
`),
  ex('inherit', 'Inheritance', 'Classes', `
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "..."

class Dog(Animal):
    def speak(self):
        return self.name + " says woof"

pets = [Dog("Rex"), Animal("Generic")]
for pet in pets:
    print(pet.speak())
`),
  ex('errors', 'Handling errors', 'Basics', `
def safe_divide(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        print("Cannot divide by zero!")
        return None

print(safe_divide(10, 2))
print(safe_divide(1, 0))

numbers = [1, 2, 3]
print(numbers[5])   # this one is not handled: watch what happens
`),
  ex('math', 'math & random', 'Standard library', `
import math
import random

random.seed(42)            # same "random" numbers every run
radius = random.randint(1, 10)
area = math.pi * radius ** 2
print(f"radius={radius} area={area:.2f}")

dice = [random.choice([1, 2, 3, 4, 5, 6]) for _ in range(5)]
print("dice:", dice, "max:", max(dice))
print("sqrt(81) =", math.sqrt(81), " floor(2.7) =", math.floor(2.7))
`),
  ex('collections', 'collections', 'Standard library', `
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
`),
  ex('datetime', 'datetime & json', 'Standard library', `
import datetime
import json

today = datetime.date(2026, 11, 19)
later = today + datetime.timedelta(days=45)
print("45 days later:", later.isoformat(), later.strftime("%A"))

person = {"name": "Linus", "langs": ["C", "Python"], "active": True}
text = json.dumps(person)
back = json.loads(text)
print(text)
print(back["langs"][1])
`),
  ex('itertools', 'itertools, functools & re', 'Standard library', `
import itertools
import functools
import re

pairs = list(itertools.combinations("ABC", 2))
total = functools.reduce(lambda a, b: a + b, [1, 2, 3, 4])

text = "Call 555-1234 or 555-9876 today"
phones = re.findall(r"\\d{3}-\\d{4}", text)
print(pairs, total, phones)
`),
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
