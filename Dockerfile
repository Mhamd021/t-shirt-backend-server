FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate
RUN rm -rf dist *.tsbuildinfo && npm run build && ls dist
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]