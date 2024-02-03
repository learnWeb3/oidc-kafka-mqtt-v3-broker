# MQTT BROKER

This is an MQTT V3 protocol compatible broker with enhanced capabilities:
- to circumvent MQTT V3 protocol limitations such as message broadcast on a external clients tointernal backend client communications to clustered microservice (MQTT V5 solve this issue using shared topics feature).
- to handle permissions to topic using Oauth2 and OPENID protocol, authenticating and authorizing users through JWT access token

Config file is validated upon broker start up.
Broker makes the use of mqemitter and mongodb database storage for clustering capabilities [https://github.com/moscajs/aedes]
This broker makes use of kafka for external clients to internal backend client communications.
In order to authenticate using a the  Oauth2 and OPENID protocol you must set oauth2 as your client username token will be passed as the password and validated against authentication/authorization server.
Internal users database is also available to authenticate against.

## Config file

[config file](./config/config.yaml)
[schemas file](./config/config.schema.json)

## Build docker image

```bash
# build docker image with ssh agent forwarding
PRIVATE_KEY=<PRIVATE KEY FILE PATH>
eval $(ssh-agent)
ssh-add $HOME/.ssh/$PRIVATE_KEY
export DOCKER_BUILDKIT=1
docker buildx build --tag=antoineleguillou/andrew-mqtt-oauth-broker:v1.6.0 --no-cache --ssh default=$SSH_AUTH_SOCK -f ./Dockerfile .
```

## Debug the broker

We use the hivemq [mqtt-cli utility](https://hivemq.github.io/mqtt-cli/)

```bash
# launch mqtt cli in shell mode
mqtt-shell
# connect to the broker authenticating your client using an internal user
connect -h andrew-mqtt-oauth-broker.students-epitech.ovh -ws -ws:path=/ -p 443 -u <USERNAME> -pw <PASSWORD> -s --tls-version TLSv1.3 --ca-cert <PATH TO ROOT CA CERT> -V 3
# connect to the broker authenticating your client using Oauth2 OPENID connect.
connect -h andrew-mqtt-oauth-broker.students-epitech.ovh -ws -ws:path=/ -p 443 -u oauth2 -pw <TOKEN> -s --tls-version TLSv1.3 --ca-cert <PATH TO ROOT CA CERT> -V 3
```
