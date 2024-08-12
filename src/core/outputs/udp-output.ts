import dgram, { Socket } from 'node:dgram';
import { ILogger, IOutputProvider, IOutputResult } from '../../types';

import { default as util } from 'util';
import { ICoreUdpPublishAction } from '../types/udp-types';

export default class CoreOutputUdp implements IOutputProvider {
  private socket: Socket;
  private logger?: ILogger;

  constructor(logger: ILogger) {
    this.socket = dgram.createSocket('udp4');
    this.logger = logger;
  }

  async outputResult(result: IOutputResult) {
    this.logger?.trace(`CoreOutputUdp.outputResult: Start`);
    // Process the incoming results
    try {
      if (result.error) {
        // The rules engine already sent in an error, so we just log and not output
        this.logger?.error(
          `CoreOutputUdp.outputResult: the result object contained an error. Nothing will publish. The error received was: ${util.inspect(
            result.error
          )}`
        );
      } else if (result?.facts?.udpPublishAction) {
        // No error + we have an facts.udpPublishAction so we publish!

        // Setup an array of actions so we can handle multiple.
        let udpPublishArray: Array<ICoreUdpPublishAction> = [];

        // Were we passed an ARRAY of udpPublishAction in facts.udpPublishAction?
        if (Array.isArray(result.facts.udpPublishAction)) {
          // It is an array, so we just set our local to the array we were passed
          udpPublishArray = result.facts.udpPublishAction;
        } else {
          // Not an array, so let's add the one action into our local array
          udpPublishArray.push(result.facts.udpPublishAction);
        }

        // Now, let's loop over the array and publish each
        for (let udpPublishAction of udpPublishArray) {
          const ip = udpPublishAction.ip;
          const port = udpPublishAction.port;
          const message = udpPublishAction.message;

          this.socket.send(message, port, ip, (err) => {
            if (err) {
              this.logger?.error(
                `CoreOutputUdp.outputResult - Error: ${err}`
              );
            }
          });
        }
      } else {
        // We don't have an udpPublishAction, so we log that.
        this.logger?.info(
          `CoreOutputUdp.outputResult: No udpPublishAction from result.facts. Nothing was published.`
        );
      }
    } catch (e: any) {
      // Oh no! Something else. Log the error.
      this.logger?.error(
        `CoreOutputUdp.outputResult: Error - INNER ERROR: ${e.message}`
      );
    }

    this.logger?.trace(`CoreOutputUdp.outputResult: End`);
  }
}
