FROM node:26-slim
WORKDIR /app
RUN npm i -g pnpm@12.5.1
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["sh", "-c", "pnpm --filter @assembly/web start -p ${PORT:-8080}"]
