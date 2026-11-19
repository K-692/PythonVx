# Title: Fibonacci numbers
# Group: Functions
def fibonacci(count):
    sequence = [0, 1]
    while len(sequence) < count:
        nxt = sequence[-1] + sequence[-2]
        sequence.append(nxt)
    return sequence

fib = fibonacci(8)
print(fib)
