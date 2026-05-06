FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG DATABASE_URL="postgresql://postgres:gAgdxqGqAVxDXwthhFHfvNGQFXSLHnDF@postgres.railway.internal:5432/railway"
ENV DATABASE_URL=${DATABASE_URL}

RUN npx prisma generate

RUN npm run build

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
