# Title: Scope & default arguments
# Group: Functions
counter = 0

def bump(step=1):
    global counter
    counter += step
    return counter

bump()
bump(5)
print("counter is", counter)
