FROM node:18.0.0-alpine As production

USER root

WORKDIR /usr/share/app/

RUN apk update && apk add --no-cache tini 

RUN apk add --no-cache openssh-client git
RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
RUN --mount=type=ssh

COPY package.json ./

RUN --mount=type=ssh npm install --verbose

COPY . .

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "main.js"]