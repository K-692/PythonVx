# Title: Handling errors
# Group: Basics
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
