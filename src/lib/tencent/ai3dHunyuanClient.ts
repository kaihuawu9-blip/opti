import 'server-only';

import { AbstractClient } from 'tencentcloud-sdk-nodejs-common';
import type { ClientConfig } from 'tencentcloud-sdk-nodejs-common';

/**
 * 混元生 3D（产品 ai3d）HTTP 客户端。
 * 使用与 `tencentcloud-sdk-nodejs-hunyuan` 相同的公共签名栈（AbstractClient），
 * 接入点与版本按中国站文档：ai3d.tencentcloudapi.com / 2025-05-13。
 *
 * @see https://cloud.tencent.com/document/product/1804/120831
 */
export class Ai3dHunyuanClient extends AbstractClient {
  constructor(clientConfig: ClientConfig) {
    super('ai3d.tencentcloudapi.com', '2025-05-13', clientConfig);
  }
}

export type TencentJsonResponse<T = Record<string, unknown>> = T & {
  RequestId?: string;
};
