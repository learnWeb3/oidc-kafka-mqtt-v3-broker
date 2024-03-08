function isAuthorizedMQTTTopic(topicPattern, topicToCheck, userId = null) {
    topicPattern = topicPattern.replaceAll(':id', userId)
    console.log('topic pattern', topicPattern, 'topic to check', topicToCheck)
    const patternSegments = topicPattern.split('/');
    const checkSegments = topicToCheck.split('/');

    for (let i = 0; i < patternSegments.length; i++) {
        if (patternSegments[i] === '#') {
            return true; // '#' wildcard matches any subtopics
        } else if (patternSegments[i] !== '+' && patternSegments[i] !== checkSegments[i]) {
            return false; // Mismatch in non-wildcard segments
        }
    }

    return true;
}

module.exports = { isAuthorizedMQTTTopic }