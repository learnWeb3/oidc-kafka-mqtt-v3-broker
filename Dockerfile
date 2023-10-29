FROM node:18.0.0-alpine As production

WORKDIR /usr/share/app/

RUN apk update && apk add --no-cache tini 

COPY ./package*.json .

RUN npm install --loglevel verbose

COPY . .

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "main.js"]