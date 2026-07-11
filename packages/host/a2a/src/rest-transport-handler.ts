/**
 * Thin REST transport wrapper over A2ARequestHandler.
 */
import { TaskState, type CancelTaskRequest, type GetTaskRequest, type ListTasksRequest, type SendMessageRequest } from '@a2a-js/sdk';
import { RequestMalformedError, UnsupportedOperationError, type A2ARequestHandler, type ServerCallContext } from '@a2a-js/sdk/server';


export class RestTransportHandler {
  constructor(private readonly requestHandler: A2ARequestHandler) {}

  async getAgentCard() {
    return this.requestHandler.getAgentCard();
  }

  async sendMessage(params: SendMessageRequest, context: ServerCallContext) {
    this.validateSendMessageRequest(params);
    return this.requestHandler.sendMessage(params, context);
  }

  async sendMessageStream(params: SendMessageRequest, context: ServerCallContext) {
    await this.requireCapability('streaming');
    this.validateSendMessageRequest(params);
    return this.requestHandler.sendMessageStream(params, context);
  }

  async getTask(taskId: string, context: ServerCallContext, historyLength?: string) {
    const params: GetTaskRequest = { id: taskId, tenant: '' };
    if (historyLength !== undefined) {
      params.historyLength = this.parseHistoryLength(historyLength);
    }
    return this.requestHandler.getTask(params, context);
  }

  async cancelTask(taskId: string, context: ServerCallContext) {
    const params: CancelTaskRequest = { id: taskId, tenant: '', metadata: {} };
    return this.requestHandler.cancelTask(params, context);
  }

  async listTasks(query: Record<string, string | undefined>, context: ServerCallContext) {
    const params: ListTasksRequest = {
      tenant: query.tenant ?? '',
      contextId: query.contextId ?? '',
      pageToken: query.pageToken ?? '',
      status: TaskState.TASK_STATE_UNSPECIFIED,
      statusTimestampAfter: undefined,
    };
    if (query.pageSize) params.pageSize = Number(query.pageSize);
    if (query.historyLength) params.historyLength = Number(query.historyLength);
    return this.requestHandler.listTasks(params, context);
  }

  private validateSendMessageRequest(params: SendMessageRequest): void {
    if (!params.message) throw new RequestMalformedError('message is required');
    if (!params.message.messageId) throw new RequestMalformedError('message.messageId is required');
  }

  private async requireCapability(capability: 'streaming' | 'pushNotifications'): Promise<void> {
    const card = await this.getAgentCard();
    if (!card.capabilities?.[capability]) {
      throw new UnsupportedOperationError(`Agent does not support ${capability}`);
    }
  }

  private parseHistoryLength(value: string): number {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new RequestMalformedError('historyLength must be a non-negative integer');
    }
    return parsed;
  }
}
