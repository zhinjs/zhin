# 镜像继承
FROM node:18
RUN mkdir /app
WORKDIR /app
RUN npm init -y
RUN npm install zhin
RUN npx zhin init
RUN npx zhin
EXPOSE 8086
CMD npm start
