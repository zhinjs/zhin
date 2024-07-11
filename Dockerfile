# 镜像继承
FROM node:18
RUN mkdir /app
COPY ./test/package.json /app
WORKDIR /app
RUN npm init -y
RUN npm install
EXPOSE 8086
CMD npm start
