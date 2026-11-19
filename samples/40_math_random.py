# Title: math & random
# Group: Standard library
import math
import random

random.seed(42)            # same "random" numbers every run
radius = random.randint(1, 10)
area = math.pi * radius ** 2
print(f"radius={radius} area={area:.2f}")

dice = [random.choice([1, 2, 3, 4, 5, 6]) for _ in range(5)]
print("dice:", dice, "max:", max(dice))
print("sqrt(81) =", math.sqrt(81), " floor(2.7) =", math.floor(2.7))
