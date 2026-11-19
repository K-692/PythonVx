# Title: Loops (for / while)
# Group: Basics
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
