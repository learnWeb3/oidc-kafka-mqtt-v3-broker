const http = require("http");
const ws = require("websocket-stream");
const Aedes = require("aedes");
const { Kafka } = require('kafkajs')
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const { join } = require("path");
const { processConfig } = require("./lib/validate-config-schema");
const { nanoid } = require("nanoid");
const { hostname } = require("os");
const { isAuthorizedMQTTTopic } = require("./lib/is-authorized-mqtt-topic");
const bcrypt = require("bcrypt");
const { v4: uuid } = require('uuid');
const { AndrewDeviceConnectEvent, AndrewDeviceDisconnectEvent } = require('andrew-events-schema');

const isProd = process.env.NODE_ENV === "production";
if (!isProd) {
    const dotenv = require("dotenv");
    dotenv.config({
        path: join(process.cwd(), ".env.development"),
    });
}

async function main() {
    /** CONFIG */
    const configPath = join(process.cwd(), "config", "config.yaml");
    const configSchemaPath = join(process.cwd(), "config", "config.schema.json");
    const config = await processConfig(configPath, configSchemaPath);

    /** KAFKA */
    const kafka = new Kafka({
        clientId: process.env.NODE_ENV === "production" ? hostname() : uuid(),
        brokers: process.env.KAFKA_BROKERS.split(','),
        sasl: {
            mechanism: 'scram-sha-512',
            username: process.env.KAFKA_SASL_USERNAME,
            password: process.env.KAFKA_SASL_PASSWORD,
        }
    })
    const producer = kafka.producer()
    await producer.connect()
        .then(() => console.log(`kafka producer connected successfully`))
        .catch((error) => console.log(error))

    // console.log(JSON.stringify(config, null, 4));

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
        id: isProd ? hostname() : nanoid(),
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

    aedes.on("clientReady", (client) => {
        try {
            if (client?.token instanceof Object) {
                const clientId = client.id
                const kafkaTopic =
                    config.config.kafka.publish.connect_event?.topic || null;
                if (kafkaTopic) {
                    // send payload to kafka
                    console.log('/////////////=======> connect', clientId)
                    const connectEvent = new AndrewDeviceConnectEvent(clientId, {
                        device: clientId,
                    })
                    console.log(JSON.stringify(connectEvent, null, 4))
                    producer.send({
                        topic: kafkaTopic,
                        messages: [
                            { key: clientId, value: JSON.stringify(connectEvent) }
                        ],
                    })
                }
            }
        } catch (error) {
            console.log(error)
        }
    });

    aedes.on("clientDisconnect", (client) => {
        try {
            if (client?.token instanceof Object) {
                const clientId = client.id
                const kafkaTopic =
                    config.config.kafka.publish.disconnect_event?.topic || null;
                if (kafkaTopic) {
                    // send payload to kafka
                    console.log('/////////////=======> disconnect', clientId)
                    const disconnectEvent = new AndrewDeviceDisconnectEvent(clientId, {
                        device: clientId
                    })
                    console.log(JSON.stringify(disconnectEvent, null, 4))
                    producer.send({
                        topic: kafkaTopic,
                        messages: [
                            { key: clientId, value: JSON.stringify(disconnectEvent) }
                        ],
                    })
                }
            }
        } catch (error) {
            console.log(error)
        }
    });

    aedes.on("publish", (packet, client) => {
        try {
            if (client?.token instanceof Object) {
                const { topic: packetTopic, payload } = packet;
                const kafkaTopic =
                    config.config.kafka.publish.client_events.find(
                        ({ mqtt_topic }) => isAuthorizedMQTTTopic(mqtt_topic, packetTopic)
                    )?.topic || null;
                if (kafkaTopic) {
                    const data = Buffer.from(payload).toString()
                    // send payload to kafka
                    console.log('/////////////=======> data', data)
                    producer.send({
                        topic: kafkaTopic,
                        messages: [
                            { key: data.subject, value: data }
                        ],
                    })
                }
            }
        } catch (error) {
            console.log(error)
        }
    });

    aedes.authenticate = (client, username, password, callback) => {
        try {
            const options = {};
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
                        console.log(`new authenticated client ${client.id}`);
                        return callback(null, true);
                    }
                );
            } else {
                // console.log(username, password.toString())
                const internalUsers = config.config.internal_users;
                const userMatch =
                    internalUsers.find(({ username }) => username === username) || null;
                // console.log(userMatch)
                if (!userMatch) {
                    return callback(null, false);
                }
                bcrypt.compare(password.toString(), userMatch.password).then(function (check) {
                    if (check) {
                        client.internal_user = userMatch
                        return callback(null, true);
                    }
                    return callback(null, false);
                });
            }
        } catch (error) {
            console.log(error)
        }
    };

    function validatePublishAuthorization(topic, clientRoles = [], roles = [], userId = null) {
        if (clientRoles?.length) {
            const clientRolesMapping = clientRoles.reduce((map, role) => {
                map[role] = true;
                return map;
            }, {});
            for (const { name, authorize_publish } of roles) {
                if (clientRolesMapping[name]) {
                    if (clientRolesMapping[name]) {
                        for (const authorizedTopicPattern of authorize_publish) {
                            const check = isAuthorizedMQTTTopic(
                                authorizedTopicPattern,
                                topic,
                                userId
                            );
                            if (check) {
                                return;
                            }
                        }
                    }
                }
            }
            throw new Error("Insufficient permissions to publish message");
        } else {
            throw new Error(
                `No roles evaluated the client seeems to not have any roles configured in matching config.yaml acls`
            );
        }
    }

    function validateSubscribeAuthorization(topic, clientRoles = [], roles = [], userId = null) {
        const clientRolesMapping = clientRoles.reduce((map, role) => {
            map[role] = true;
            return map;
        }, {});
        for (const { name, authorize_subscribe } of roles) {
            if (clientRolesMapping[name]) {
                for (const authorizedTopicPattern of authorize_subscribe) {
                    const check = isAuthorizedMQTTTopic(authorizedTopicPattern, topic, userId);
                    if (check) {
                        return;
                    }
                }
            }
        }
        throw new Error("Insufficient permissions to subscribe");
    }

    aedes.authorizePublish = (client, packet, callback) => {
        const topic = packet?.topic;
        if (client?.token && client.token instanceof Object) {
            try {
                const rolesKey = config.config.openid.roles_key;
                const subKey = config.config.openid.subject_key
                const clientRoles = client.token[rolesKey] || [];
                validatePublishAuthorization(
                    topic,
                    clientRoles,
                    config.config.acl,
                    client.token[subKey]
                );
                console.log(
                    `client ${client.id} published new message to topic ${topic}`
                );
                return callback(null);
            } catch (error) {
                console.log(error.message);
                return callback(error);
            }
        }

        if (client?.internal_user && client.internal_user instanceof Object) {
            console.log(client.internal_user)
            try {
                // same role as username for an internal user the role muste exists in the acl
                const clientRoles = [
                    client.internal_user.username
                ];
                validatePublishAuthorization(
                    topic,
                    clientRoles,
                    config.config.acl,
                    client.internal_user.username
                );
                console.log(
                    `client ${client.id} published new message to topic ${topic}`
                );
                return callback(null);
            } catch (error) {
                console.log(error.message);
                return callback(error);
            }
        }

        callback(new Error("Cannot publish"));
    };

    aedes.authorizeSubscribe = (client, subscription, callback) => {
        const topic = subscription.topic;
        // console.log(subscription);
        if (client?.token && client.token instanceof Object) {
            try {
                const rolesKey = config.config.openid.roles_key;
                const subKey = config.config.openid.subject_key
                const clientRoles = client.token[rolesKey] || [];
                validateSubscribeAuthorization(
                    topic,
                    clientRoles,
                    config.config.acl,
                    client.token[subKey]
                );
                console.log(`client ${client.id} subscribed to topic ${topic}`);
                return callback(null, subscription);
            } catch (error) {
                console.log(error.message);
                return callback(error);
            }
        }

        if (client?.internal_user && client.internal_user instanceof Object) {
            try {
                // same role as username for an internal user the role muste exists in the acl
                const clientRoles = [
                    client.internal_user.username
                ];
                validateSubscribeAuthorization(
                    topic,
                    clientRoles,
                    config.config.acl,
                    client.internal_user.username
                );
                console.log(`client ${client.id} subscribed to topic ${topic}`);
                return callback(null, subscription);
            } catch (error) {
                console.log(error.message);
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
