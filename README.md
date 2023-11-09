```bash
# build docker image with ssh agent forwarding
PRIVATE_KEY=<PRIVATE KEY FILE PATH>
eval $(ssh-agent)
ssh-add $HOME/.ssh/$PRIVATE_KEY
export DOCKER_BUILDKIT=1
docker buildx build --tag=antoineleguillou/andrew-mqtt-oauth-broker:v1.2 --no-cache --ssh default=$SSH_AUTH_SOCK -f ./Dockerfile .
```
