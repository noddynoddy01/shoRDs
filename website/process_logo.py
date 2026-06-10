from PIL import Image
import numpy as np

# Load the original image from the brain directory
orig_path = 'C:/Users/abhin/.gemini/antigravity/brain/73e750c0-27f8-4e19-a690-c88aa04fdfa0/shords_logo_1781089346060.png'
img = Image.open(orig_path).convert('RGBA')
width, height = img.size
data = np.array(img, dtype=np.float32)

# Extract channels
r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]

# Define a metric of "whiteness"
# White background is close to (255, 255, 255)
whiteness = np.minimum(np.minimum(r, g), b)

# Create a visited mask for BFS
visited = np.zeros((height, width), dtype=bool)
queue = []

# Threshold for starting the background BFS
# Background pixels are very close to white
bg_thresh = 200.0

# Add all border pixels that are white/light to the BFS queue
for x in range(width):
    for y in [0, height - 1]:
        if whiteness[y, x] > bg_thresh:
            queue.append((x, y))
            visited[y, x] = True

for y in range(height):
    for x in [0, width - 1]:
        if not visited[y, x]:
            if whiteness[y, x] > bg_thresh:
                queue.append((x, y))
                visited[y, x] = True

# BFS to find all connected background pixels
head = 0
directions = [(1,0), (-1,0), (0,1), (0,-1), (1,1), (-1,-1), (1,-1), (-1,1)]
while head < len(queue):
    cx, cy = queue[head]
    head += 1
    
    for dx, dy in directions:
        nx, ny = cx + dx, cy + dy
        if 0 <= nx < width and 0 <= ny < height:
            if not visited[ny, nx]:
                # If it's light enough, it's background
                if whiteness[ny, nx] > bg_thresh:
                    visited[ny, nx] = True
                    queue.append((nx, ny))

# Now we have the background mask in `visited`
# To avoid a white halo around the logo, we can identify pixels adjacent to the background
# and apply a gradient transparency (feathering) or just extend transparency slightly.
# Let's do a soft threshold: if a pixel is background or near background, we set its alpha.
# For any pixel that is visited:
# We make it fully transparent.
# For pixels NOT visited but still very light, let's make them partially transparent to smooth the edges.
new_alpha = np.copy(a)
new_alpha[visited] = 0.0

# Soft blend at the boundary:
# Find pixels not visited, but very close to white (whiteness > 200)
# and adjust their alpha to avoid harsh white edges
for y in range(height):
    for x in range(width):
        if not visited[y, x] and whiteness[y, x] > 200:
            # The closer to 255, the more transparent (alpha -> 0)
            # Let's scale alpha from 255 (at whiteness 200) to 0 (at whiteness 255)
            factor = (255.0 - whiteness[y, x]) / (255.0 - 200.0)
            factor = max(0.0, min(1.0, factor))
            new_alpha[y, x] = factor * 255.0

data[:,:,3] = new_alpha

# Save the result back as logo.png
result = Image.fromarray(data.astype(np.uint8), 'RGBA')
result.save('assets/logo.png', 'PNG')
print("Successfully processed logo.png with clean transparent background!")
