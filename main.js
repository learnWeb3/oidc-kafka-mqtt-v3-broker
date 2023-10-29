const http = require("http");
const ws = require("websocket-stream");
const Aedes = require("aedes");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const dotenv = require("dotenv");
const { join } = require("path");
const { processConfig } = require("./lib/validate-config-schema");
const { nanoid } = require("nanoid");
const { hostname } = require("os");
const { isAuthorizedMQTTTopic } = require("./lib/is-authorized-mqtt-topic");

const isProd = process.env.NODE_ENV === "production";
if (isProd) {
    dotenv.config({
        path: join(process.cwd(), ".env.development"),
    });
}

async function main() {
    /** CONFIG */
    const configPath = join(process.cwd(), "config", "config.yaml");
    const configSchemaPath = join(process.cwd(), "config", "config.schema.json");
    const config = await processConfig(configPath, configSchemaPath);

    console.log(JSON.stringify(config, null, 4));

    /** PERSISTENCE + MQ EMITTER */
    const mq = require("mqemitter-mongodb")({
        url: process.env.MONGO_URL,
    });
    const persistence = require("aedes-persistence-mongodb")({
        url: process.env.MONGO_URL,
    });

    /** HTTP SERVER AND MQTT BROKER */
    const httpServer = http.createServer();
    const aedes = new Aedes({
        id: "BROKER_" + isProd ? hostname() : nanoid(),
        mq,
        persistence,
    });
    const port = process.env.WEBSOCKET_PORT || 8888;

    /** JWKS CLIENT */
    const client = jwksClient({
        jwksUri: config.config.openid.connect_url,
    });
    function getKey(header, callback) {
        client.getSigningKey(header.kid, function (err, key) {
            const signingKey = key.publicKey || key.rsaPublicKey;
            callback(null, signingKey);
        });
    }

    aedes.authenticate = (client, username, password, callback) => {
        if (username === "oauth2") {
            return jwt.verify(
                password.toString(),
                getKey,
                options,
                function (err, decoded) {
                    if (err) {
                        return callback(err, false);
                    }
                    client.token = decoded;
                    return callback(null, true);
                }
            );
        }
        return callback(null, false);
    };

    function validatePublishAuthorization(topic, rolesKey, client, roles) {
        const clientRoles = client.token[rolesKey];
        const clientRolesMapping = clientRoles.reduce((map, role) => {
            map[role] = true;
            return map;
        }, {});
        for (const { name, authorizePublish } of roles) {
            if (clientRolesMapping[name]) {
                if (clientRolesMapping[name]) {
                    for (const authorizedTopicPattern of authorizePublish) {
                        const check = isAuthorizedMQTTTopic(authorizedTopicPattern, topic);
                        if (check) {
                            return;
                        }
                    }
                }
            }
        }
        throw new Error("Insufficient to permissions to publish message");
    }

    function validateSubscribeAuthorization(topic, rolesKey, client, roles) {
        const clientRoles = client.token[rolesKey];
        const clientRolesMapping = clientRoles.reduce((map, role) => {
            map[role] = true;
            return map;
        }, {});
        for (const { name, authorizeSubscribe } of roles) {
            if (clientRolesMapping[name]) {
                for (const authorizedTopicPattern of authorizeSubscribe) {
                    const check = isAuthorizedMQTTTopic(authorizedTopicPattern, topic);
                    if (check) {
                        return;
                    }
                }
            }
        }
        throw new Error("Insufficient to permissions to subscribe");
    }

    aedes.authorizePublish = (client, packet, callback) => {
        const topic = packet.topic;
        if (client.token instanceof Object) {
            try {
                validatePublishAuthorization(
                    topic,
                    config.config.openid.roles_key,
                    client,
                    config.config.roles
                );
                return callback(null);
            } catch (error) {
                return callback(error);
            }
        }

        callback(new Error("Cannot publish"));
    };

    aedes.authorizeSubscribe = (client, subscription, callback) => {
        const topic = subscription.topic;
        if (client.token instanceof Object) {
            try {
                validateSubscribeAuthorization(
                    topic,
                    config.config.openid.roles_key,
                    client,
                    config.config.roles
                );
                return callback(null, subscription);
            } catch (error) {
                return callback(error);
            }
        }

        callback(new Error("Cannot subscribe"));
    };

    // websocket
    ws.createServer({ server: httpServer }, aedes.handle);

    httpServer.listen(port, function () {
        console.log("websocket server listening on port ", port);
    });
}

main();
