# Title: Reading input
# Group: Basics
# Input: Grace|1990
# Type the answers into the "Program input" box, one per line.
name = input("What is your name? ")
year = int(input("What year were you born? "))
age = 2026 - year
print(f"Hi {name}, you are about {age} years old.")
