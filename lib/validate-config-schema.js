const Validator = require('jsonschema').Validator;
const { parse } = require('yaml')
const fs = require('fs/promises')

function validateConfigSchema(config, configSchema) {
    try {
        const validator = new Validator();
        validator.validate(config, configSchema, {
            throwAll: true
        });
    } catch (error) {
        const message = error.errors.map(({ property, message }) => `${property} ${message}`).join(", ")
        throw new Error(message)
    }
}

async function processConfig(configPath, configSchemaPath) {
    const config = await fs
        .readFile(configPath, {
            encoding: "utf-8",
        })
        .then((data) => parse(data));
    const configSchema = await fs.readFile(configSchemaPath, {
        encoding: "utf-8",
    }).then((data) => JSON.parse(data));
    validateConfigSchema(config, configSchema)
    return config
}

module.exports = { processConfig }