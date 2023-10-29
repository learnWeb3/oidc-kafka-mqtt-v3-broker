function isAuthorizedMQTTTopic(topicPattern, topicToCheck) {
    const patternSegments = topicPattern.split('/');
    const checkSegments = topicToCheck.split('/');

    if (patternSegments.length !== checkSegments.length) {
        return false; // Topics have different levels
    }

    for (let i = 0; i < patternSegments.length; i++) {
        if (patternSegments[i] !== '+' && patternSegments[i] !== '#' && patternSegments[i] !== checkSegments[i]) {
            return false; // Mismatch in non-wildcard segments
        }
    }

    return true;
}

module.exports = { isAuthorizedMQTTTopic }