  
/**
 * Core MQTT Publish Action - Used for the Core MQTT Output
 *
 * This object is used to control what the Core MQTT Output publishes.
 *
 * This is intended to be passed inside an ARRAY of these in order to send multiple messages!
 */
export interface ICoreMQTTPublishAction {
    // The exchange to publish into
    mqttTopic: string;
    // The content of the message, which should already be a string. Applications should JSON.stringify before passing.
    mqttMessage: string;
}

export interface ICoreMqttMessage {
    topic: string;
    message: string;
}