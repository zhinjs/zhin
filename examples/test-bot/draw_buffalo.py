from PIL import Image, ImageDraw, ImageFont
import random

# 创建画布
width, height = 800, 600
img = Image.new('RGB', (width, height), color='skyblue')  # 天空背景
draw = ImageDraw.Draw(img)

# 绘制草地（底部绿色区域）
grass_y = height * 2 // 3  # 草地从高度的2/3处开始
draw.rectangle([0, grass_y, width, height], fill='green')

# 绘制一些草地纹理
for i in range(50):
    x = random.randint(0, width)
    y = random.randint(grass_y, height - 10)
    draw.line([x, y, x + random.randint(-5, 5), y - random.randint(5, 15)], fill='darkgreen', width=2)

# 绘制水牛
# 水牛身体（椭圆形）
body_x, body_y = 350, grass_y - 80
body_width, body_height = 180, 100
draw.ellipse([body_x, body_y, body_x + body_width, body_y + body_height], fill='brown')

# 水牛头部（椭圆形，向下倾斜吃草）
head_x, head_y = body_x + body_width - 40, body_y + body_height - 20
head_width, head_height = 70, 50
draw.ellipse([head_x, head_y, head_x + head_width, head_y + head_height], fill='brown')

# 水牛角（两个三角形）
horn_length = 30
# 左角
draw.polygon([(head_x + 15, head_y + 10), (head_x + 5, head_y - horn_length), (head_x + 25, head_y + 10)], fill='white')
# 右角
draw.polygon([(head_x + 45, head_y + 10), (head_x + 65, head_y - horn_length), (head_x + 55, head_y + 10)], fill='white')

# 水牛眼睛（黑色圆点）
eye_x, eye_y = head_x + 35, head_y + 25
draw.ellipse([eye_x, eye_y, eye_x + 8, eye_y + 8], fill='black')

# 水牛四条腿（四个矩形）
leg_width = 15
leg_height = 60
# 前腿
draw.rectangle([body_x + 20, body_y + body_height - 10, body_x + 20 + leg_width, body_y + body_height + leg_height - 10], fill='brown')
draw.rectangle([body_x + 45, body_y + body_height - 10, body_x + 45 + leg_width, body_y + body_height + leg_height - 10], fill='brown')
# 后腿
draw.rectangle([body_x + body_width - 60, body_y + body_height - 10, body_x + body_width - 60 + leg_width, body_y + body_height + leg_height - 10], fill='brown')
draw.rectangle([body_x + body_width - 35, body_y + body_height - 10, body_x + body_width - 35 + leg_width, body_y + body_height + leg_height - 10], fill='brown')

# 水牛尾巴（一条曲线）
tail_start_x = body_x + body_width - 10
tail_start_y = body_y + body_height // 2
tail_end_x = tail_start_x + 40
tail_end_y = tail_start_y - 30
draw.line([tail_start_x, tail_start_y, tail_end_x, tail_end_y], fill='brown', width=3)
# 尾巴末端的小刷子
draw.ellipse([tail_end_x - 10, tail_end_y - 10, tail_end_x + 10, tail_end_y + 10], fill='brown')

# 绘制太阳（右上角）
sun_x, sun_y = 650, 80
sun_radius = 60
draw.ellipse([sun_x - sun_radius, sun_y - sun_radius, sun_x + sun_radius, sun_y + sun_radius], fill='yellow')
# 太阳光线
for angle in range(0, 360, 30):
    import math
    x1 = sun_x + int(sun_radius * 1.2 * math.cos(math.radians(angle)))
    y1 = sun_y + int(sun_radius * 1.2 * math.sin(math.radians(angle)))
    x2 = sun_x + int(sun_radius * 1.5 * math.cos(math.radians(angle)))
    y2 = sun_y + int(sun_radius * 1.5 * math.sin(math.radians(angle)))
    draw.line([x1, y1, x2, y2], fill='yellow', width=3)

# 添加标题
try:
    # 尝试加载字体
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
except:
    # 如果找不到字体，使用默认字体
    font = ImageFont.load_default()

title = "水牛吃草示意图"
# 计算文本位置使其居中
text_bbox = draw.textbbox((0, 0), title, font=font)
text_width = text_bbox[2] - text_bbox[0]
text_height = text_bbox[3] - text_bbox[1]
text_x = (width - text_width) // 2
text_y = 30
draw.text((text_x, text_y), title, fill='black', font=font)

# 保存图片
output_path = "buffalo_grazing.png"
img.save(output_path)
print(f"图片已保存到: {output_path}")
