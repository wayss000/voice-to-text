FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 启动应用
CMD ["npm", "start"] 