# Title: Lists
# Group: Data
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
