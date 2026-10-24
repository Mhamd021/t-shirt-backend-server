FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma7 generate
RUN rm -rf dist *.tsbuildinfo && npm run build && ls dist
EXPOSE 3001

CMD ["sh", "-c", "npx prisma7 migrate deploy && node dist/main"]