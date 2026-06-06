import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

# 创建图形和轴
fig, ax = plt.subplots(figsize=(10, 7))

# 设置背景颜色
ax.set_facecolor('skyblue')

# 绘制草地（绿色矩形）
grass_height = 0.3
grass_y = 0.7
grass = patches.Rectangle((0, grass_y), 1, grass_height, color='green', alpha=0.8)
ax.add_patch(grass)

# 绘制一些草地纹理
for i in range(30):
    x = np.random.uniform(0, 1)
    y = np.random.uniform(grass_y, 1)
    ax.plot([x, x + np.random.uniform(-0.01, 0.01)], 
            [y, y - np.random.uniform(0.01, 0.03)], 
            color='darkgreen', linewidth=1.5)

# 绘制水牛（简化形状）
# 身体（椭圆形）
body = patches.Ellipse((0.45, 0.55), 0.25, 0.15, color='brown', alpha=0.9)
ax.add_patch(body)

# 头部（椭圆形，向下倾斜）
head = patches.Ellipse((0.6, 0.48), 0.1, 0.08, color='brown', alpha=0.9)
ax.add_patch(head)

# 角（两个三角形）
horn1 = patches.Polygon([(0.57, 0.52), (0.56, 0.57), (0.58, 0.52)], 
                        color='white', alpha=0.9)
horn2 = patches.Polygon([(0.62, 0.52), (0.61, 0.57), (0.63, 0.52)], 
                        color='white', alpha=0.9)
ax.add_patch(horn1)
ax.add_patch(horn2)

# 眼睛（黑色圆点）
eye = patches.Circle((0.61, 0.49), 0.005, color='black')
ax.add_patch(eye)

# 四条腿（四个矩形）
leg_width = 0.02
leg_height = 0.1
# 前腿
leg1 = patches.Rectangle((0.42, 0.45), leg_width, leg_height, color='brown', alpha=0.9)
leg2 = patches.Rectangle((0.44, 0.45), leg_width, leg_height, color='brown', alpha=0.9)
# 后腿
leg3 = patches.Rectangle((0.53, 0.45), leg_width, leg_height, color='brown', alpha=0.9)
leg4 = patches.Rectangle((0.55, 0.45), leg_width, leg_height, color='brown', alpha=0.9)
ax.add_patch(leg1)
ax.add_patch(leg2)
ax.add_patch(leg3)
ax.add_patch(leg4)

# 尾巴（一条曲线）
tail_x = [0.57, 0.62, 0.65]
tail_y = [0.55, 0.58, 0.62]
ax.plot(tail_x, tail_y, color='brown', linewidth=2)

# 太阳（右上角）
sun = patches.Circle((0.85, 0.85), 0.08, color='yellow', alpha=0.9)
ax.add_patch(sun)

# 添加太阳光线
for angle in np.linspace(0, 2*np.pi, 12, endpoint=False):
    x1 = 0.85 + 0.1 * np.cos(angle)
    y1 = 0.85 + 0.1 * np.sin(angle)
    x2 = 0.85 + 0.12 * np.cos(angle)
    y2 = 0.85 + 0.12 * np.sin(angle)
    ax.plot([x1, x2], [y1, y2], color='yellow', linewidth=1.5)

# 设置坐标轴
ax.set_xlim(0, 1)
ax.set_ylim(0, 1)
ax.set_aspect('equal')
ax.axis('off')

# 添加标题
plt.title('水牛吃草示意图', fontsize=16, fontweight='bold', pad=20)

# 保存图片
plt.tight_layout()
plt.savefig('buffalo_grazing_matplotlib.png', dpi=150, bbox_inches='tight')
print("matplotlib图片已保存到: buffalo_grazing_matplotlib.png")
