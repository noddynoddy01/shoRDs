from PIL import Image
import numpy as np

# Open original logo with white background
img = Image.open("assets/logo.png").convert("RGBA")
data = np.array(img, dtype=np.float32)

r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]

# Any pixel that is near-white OR checkerboard grey → transparent
# White: R>220, G>220, B>220
# Checkerboard light: ~200,200,200
# Checkerboard dark: ~150,150,150
near_white  = (r > 215) & (g > 215) & (b > 215)
checkerboard = ((r > 140) & (r < 180)) & ((g > 140) & (g < 180)) & ((b > 140) & (b < 180))

mask = near_white | checkerboard

# Set those pixels fully transparent
data[:,:,3] = np.where(mask, 0, 255)

result = Image.fromarray(data.astype(np.uint8), "RGBA")
result.save("assets/logo.png", "PNG")
print("Done — white background removed, saved as transparent PNG")
