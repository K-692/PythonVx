# Title: Nested lists (grid)
# Group: Data
grid = [[1, 2, 3],
        [4, 5, 6]]
total = 0
for row in grid:
    for cell in row:
        total += cell
grid[1][2] = 60
print(total, grid)
