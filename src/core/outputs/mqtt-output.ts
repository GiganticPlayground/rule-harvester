import { MqttClient } from 'mqtt';
import { ILogger, IOutputProvider, IOutputResult } from '../../types';

import { default as util } from 'util';
import { ICoreMQTTPublishAction } from '../types/mqtt-types';

export default class CoreOutputMqtt implements IOutputProvider {
  private mqttClient: MqttClient;
  private logger?: ILogger;

  constructor(client: MqttClient, logger: ILogger) {
    this.mqttClient = client;
    this.logger = logger;
  }

  async outputResult(result: IOutputResult) {
    this.logger?.trace(`CoreOutputMqtt.outputResult: Start`);
    // Process the incoming results
    try {
      if (result.error) {
        // The rules engine already sent in an error, so we just log and not output
        this.logger?.error(
          `CoreOutputMqtt.outputResult: the result object contained an error. Nothing will publish. The error received was: ${util.inspect(
            result.error
          )}`
        );
      } else if (result?.facts?.mqttPublishAction) {
        // No error + we have an facts.mqttPublishAction so we publish!

        // Setup an array of actions so we can handle multiple.
        let mqttPublishArray: Array<ICoreMQTTPublishAction> = [];

        // Were we passed an ARRAY of mqttPublishAction in facts.mqttPublishAction?
        if (Array.isArray(result.facts.mqttPublishAction)) {
          // It is an array, so we just set our local to the array we were passed
          mqttPublishArray = result.facts.mqttPublishAction;
        } else {
          // Not an array, so let's add the one action into our local array
          mqttPublishArray.push(result.facts.mqttPublishAction);
        }

        // Now, let's loop over the array and publish each
        for (let mqttPublishAction of mqttPublishArray) {
          const topic = mqttPublishAction.mqttTopic;
          const message = mqttPublishAction.mqttMessage;

          this.mqttClient.publish(topic, message, {retain: true});
          this.logger?.info(
            `CoreOutputMqtt.outputResult: Message published to topic='${topic}' message='${util.inspect(message)}'.`
          );
        }
      } else {
        // We don't have an mqttPublishAction, so we log that.
        this.logger?.info(
          `CoreOutputMqtt.outputResult: No mqttPublishAction from result.facts. Nothing was published.`
        );
      }
    } catch (e: any) {
      // Oh no! Something else. Log the error.
      this.logger?.error(
        `CoreOutputMqtt.outputResult: Error - INNER ERROR: ${e.message}`
      );
    }

    this.logger?.trace(`CoreOutputMqtt.outputResult: End`);
  }
}
