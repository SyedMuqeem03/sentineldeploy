FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm install --omit=dev

COPY app ./app
RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "app/src/app.js"]
