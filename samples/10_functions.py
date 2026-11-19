# Title: Functions
# Group: Functions
def area(width, height):
    result = width * height
    return result

def describe(w, h):
    a = area(w, h)
    return f"A {w}x{h} rectangle has area {a}"

print(describe(3, 4))
print(describe(5, 2))
