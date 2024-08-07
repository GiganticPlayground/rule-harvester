import { RemoteInfo } from 'node:dgram';

export interface ICoreUdpRequest {
  body: string;
  remoteInfo: RemoteInfo;
  port: number;
}

export interface ICoreUdpPublishAction {
  ip: string;
  port: number;
  message: string;
}
