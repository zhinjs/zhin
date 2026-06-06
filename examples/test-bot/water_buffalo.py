import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

# 创建一个图形和坐标轴
fig, ax = plt.subplots(figsize=(10, 6))

# 设置坐标轴范围
ax.set_xlim(0, 10)
ax.set_ylim(0, 8)

# 隐藏坐标轴
ax.axis('off')

# 绘制天空背景（浅蓝色）
sky = patches.Rectangle((0, 3), 10, 5, color='lightblue', zorder=0)
ax.add_patch(sky)

# 绘制草地（绿色矩形）
grass = patches.Rectangle((0, 0), 10, 3, color='green', zorder=1)
ax.add_patch(grass)

# 绘制一些草（小绿色线条）
np.random.seed(42)  # 确保可重复性
for i in range(50):
    x = np.random.uniform(0, 10)
    y = np.random.uniform(0.2, 2.8)
    height = np.random.uniform(0.3, 0.8)
    plt.plot([x, x], [y, y + height], color='darkgreen', linewidth=2, zorder=2)

# 绘制水牛（黑色形状）
# 身体（黑色矩形）
buffalo_body = patches.Rectangle((3, 1.2), 2.5, 1.2, color='black', zorder=3)
ax.add_patch(buffalo_body)

# 头部（黑色椭圆）
buffalo_head = patches.Ellipse((2.5, 1.8), 0.8, 0.6, color='black', zorder=3)
ax.add_patch(buffalo_head)

# 四肢（黑色线条）
for x in [3.2, 3.8, 4.5, 5.2]:
    plt.plot([x, x], [1.2, 0.5], color='black', linewidth=4, zorder=3)

# 角（白色曲线）
# 左角
theta1 = np.linspace(0, np.pi/2, 10)
x1 = 2.3 + 0.3 * np.cos(theta1)
y1 = 2.1 + 0.4 * np.sin(theta1)
plt.plot(x1, y1, color='white', linewidth=3, zorder=4)

# 右角
theta2 = np.linspace(np.pi/2, np.pi, 10)
x2 = 2.5 + 0.3 * np.cos(theta2)
y2 = 2.1 + 0.4 * np.sin(theta2)
plt.plot(x2, y2, color='white', linewidth=3, zorder=4)

# 眼睛（小白点）
plt.scatter(2.35, 1.85, color='white', s=20, zorder=5)

# 添加太阳
sun = patches.Circle((8.5, 7), 0.5, color='yellow', zorder=2)
ax.add_patch(sun)

# 添加云朵（三个白色圆形）
cloud1 = patches.Circle((2, 7), 0.4, color='white', zorder=2)
cloud2 = patches.Circle((2.4, 7.2), 0.3, color='white', zorder=2)
cloud3 = patches.Circle((1.6, 7.1), 0.35, color='white', zorder=2)
ax.add_patch(cloud1)
ax.add_patch(cloud2)
ax.add_patch(cloud3)

# 添加一些花朵（红色小点）
np.random.seed(123)
for i in range(15):
    x = np.random.uniform(0, 10)
    y = np.random.uniform(0.1, 2.5)
    plt.scatter(x, y, color='red', s=30, zorder=4)

# 添加标题（使用英文避免字体问题）
plt.title('Water Buffalo Grazing Diagram', fontsize=16, fontweight='bold')

# 保存图片
plt.savefig('water_buffalo.png', dpi=150, bbox_inches='tight')
print('图片已保存为 water_buffalo.png')
plt.close()  # 关闭图形，避免显示