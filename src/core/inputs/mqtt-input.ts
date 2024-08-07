import { IInputProvider, ILogger } from '../../types';
import _ from 'lodash';
import { MqttClient } from 'mqtt';
import { default as util } from 'util';
import { ICoreMqttMessage } from '../types/mqtt-types';


export interface ICoreInputMqttProviderOptions {
  inputContextCallback?: (topic: string, message: Buffer) => void;
}


/**
 * Rule Input Provider Mqtt
 *
 * This class wires up a MqttClient to a rule input provider.
 *
 * Usage:
 * 1. Instantiate the class and pass in the instantiated MqttClient and logger
 * 2. call registerHandler to register the input callback
 * 3. When input comes in, the handler registered in step 2 will be called
 *
 **/
export default class CoreInputMqtt implements IInputProvider {
  private alreadyRegistered: boolean;
  private handler!: (input: any, context: any) => Promise<any>;
  private logger?: ILogger;
  private mqttClient: MqttClient;
  private mqttTopic: string;
  private options: ICoreInputMqttProviderOptions;

  /**
   * constructor
   *
   * This function sets class level variables.
   *
   **/
  constructor(
    mqttClient: MqttClient,
    mqttTopic: string,
    logger: ILogger | undefined,
    options: ICoreInputMqttProviderOptions
  ) {
    this.alreadyRegistered = false;
    // Save the constructor parameters to local class variables
    this.logger = logger;
    this.mqttClient = mqttClient;
    this.mqttTopic = mqttTopic;
    this.options = options;
  }

  /**
   * registerHandler
   *
   * Does this by...
   * 1. Points the passed in applyInputCb to a class instance handler
   * 2. If this is the first call then we register an amqpCacoon consumer which in turn
   *    registers an mqttHandler function that will receive all new AMQP messages.
   *
   * @param applyInputCb - a handler that will be called when there is input. It should be passed input and context.
   * @returns Promise<void>
   **/
  async registerInput(
    applyInputCb: (input: any, context: any) => Promise<any>
  ) {
    this.logger?.trace(`CoreInputMqtt.registerHandler: Start`);
    
    // Link applyInputCb to a class property we can reference later
    this.handler = applyInputCb;
    
    if (!this.alreadyRegistered) {
      // 2. If we are not already setup subscribe to the topic and register the handler
      this.mqttClient.subscribe(this.mqttTopic, (error) => this.logger?.error(`CoreInputMqtt.registerHandler: Error subscribing to topic ${this.mqttTopic}: ${error}`));
      this.mqttClient.on('message', (topic, message) => this.mqttHandler(topic, message));

      this.alreadyRegistered = true;
    }

    this.logger?.trace(`CoreInputMqtt.registerHandler: End`);
  }

  /**
   * mqttHandler
   *
   * This is the function that we register with mqttClient on message.
   *
   * Note tha this INPUT provider adds a SPECIFIC object into facts with property mqttMessage.
   * mqttMessage in turn has three objects:
   * - topic: a string containing the MQTT Topic.
   * - message: string containing the MQTT message.
   *
   * @param channel: the active/open AMQP channel (inside a ChannelWrapper from node-amqp-connection-manager) to consume from.
   * @param msg: object - the message object, ConsumeMessage type.
   * @return Promise<void>
   **/
  async mqttHandler(topic: string, message: Buffer) {
    this.logger?.trace(`CoreInputMqtt.mqttHandler: Start`);
    let output = {facts: undefined, error: undefined}
    let mqttMessage: ICoreMqttMessage | undefined= undefined;
    try {
      // Create an object for our message - note we DO NOT validate the message here at all!
      // It will be set to a string with whatever. it's the responsibility of the application
      // using this Input to validate and THROW an error with the name 'MessageValidationError'
      // which this method will catch and treat differently!
      
      // Convert the Buffer to a string
      const messageString = message.toString();

      mqttMessage = {
        topic,
        message: messageString,
      };

      // And an object for our context
      let context: any = {};

      // Call the inputContextCallback if we were passed one
      if (this.options.inputContextCallback) {
        context = _.merge(context, this.options.inputContextCallback(topic, message));
      }

      this.logger?.debug(
        `CoreInputMqtt.mqttHandler - mqttMessage: ${util.inspect(mqttMessage)}`
      );

      // Call our handler with an object for facts called mqttMessage that wraps our
      // ICoremqttMessage. Why? This input can't "own" the facts structure of the rules engine
      // since that should be driven by an application. Therefore, we just put in 1 item into
      // facts, an mqttMessage and then let the application do whatever it wants/needs.
      // Note, the handler WILL return updated facts, but we're not using them in this input!
      output.facts = await this.handler(
        { mqttMessage },
        context
      );
    } catch (e: any) {
      output.error = e;
      // Handle errors!

      // If this is a message validation error then we do not need to retry because this is not going to magically be fixed.
      // Note: Applications using this Input are expected to return an error name == 'MessageValidationError'
      // to trigger this first condition! These messages, since they are invalid, are ACK so that they don't
      // requeue forever! (They're expected to fail any retry, since they're invalid!)
      if (e.name === 'MessageValidationError') {
        this.logger?.error(
          `CoreInputMqtt.mqttHandler: Validation Error: ${e.message}`
        );
      } else {
        // Otherwise, the error is something other than INVALID MESSAGE, so we deal with it.
        this.logger?.error(
          `CoreInputMqtt.mqttHandler - ERROR: ${e.message}`
        );
      }
      this.logger?.trace(`The message contained: ${message.toString()}`);
    }

    this.logger?.trace(`CoreInputMqtt.mqttHandler: End`);
  }
}
