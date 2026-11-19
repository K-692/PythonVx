# Title: Dictionaries
# Group: Data
ages = {"ann": 31, "bob": 27}
ages["cara"] = 22
ages["bob"] += 1

for name, age in ages.items():
    print(name, "is", age)

oldest = max(ages, key=ages.get)
print("Oldest:", oldest)
