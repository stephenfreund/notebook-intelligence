// Copyright (c) Mehmet Bektas <mbektasgh@outlook.com>

import { ServerConnection } from '@jupyterlab/services';
import { requestAPI } from './handler';
import { URLExt } from '@jupyterlab/coreutils';
import { UUID } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import {
  GITHUB_COPILOT_PROVIDER_ID,
  IChatCompletionResponseEmitter,
  IChatParticipant,
  IContextItem,
  INbiChatToolCallSummary,
  INbiToolCallStarted,
  ITelemetryEvent,
  IToolSelections,
  NbiChatMode,
  RequestDataType,
  BackendMessageType,
  AssistantMode
} from './tokens';
import type { NbiChatObservable } from './chat-observable';

/**
 * Internal per-round bookkeeping. Created when a `chatRequest`,
 * `generateCode`, or `inlineCompletionsRequest` begins; removed on
 * StreamEnd. The shared `_messageReceived` dispatcher routes incoming
 * websocket messages here by `msg.id`.
 */
interface IChatRound {
  messageId: string;
  chatId: string;
  mode: NbiChatMode;
  responseEmitter: IChatCompletionResponseEmitter;
  startedAt: number;
  textParts: string[];
  toolCalls: INbiChatToolCallSummary[];
  /**
   * Set when the UI cancels the round (via `sendWebSocketMessage` with a
   * Cancel* type). The terminating `StreamEnd` is still forwarded to the
   * response emitter but no `responseCompleted` is fired on the observable.
   */
  cancelled: boolean;
}

/**
 * Key for `_pendingToolCalls`. Tool calls are scoped per-round, but the
 * map is global since `completeToolCall` is invoked without a round handle.
 */
function toolCallKey(messageId: string, callbackId: string): string {
  return `${messageId}:${callbackId}`;
}

export enum GitHubCopilotLoginStatus {
  NotLoggedIn = 'NOT_LOGGED_IN',
  ActivatingDevice = 'ACTIVATING_DEVICE',
  LoggingIn = 'LOGGING_IN',
  LoggedIn = 'LOGGED_IN'
}

export interface IDeviceVerificationInfo {
  verificationURI: string;
  userCode: string;
}

export enum ClaudeModelType {
  None = 'none',
  Inherit = 'inherit',
  Default = ''
}

export interface IClaudeModelInfo {
  id: string;
  name: string;
  context_window: number;
}

export enum ClaudeToolType {
  ClaudeCodeTools = 'claude-code:built-in-tools',
  JupyterUITools = 'nbi:built-in-jupyter-ui-tools'
}

export class NBIConfig {
  get userHomeDir(): string {
    return this.capabilities.user_home_dir;
  }

  get userConfigDir(): string {
    return this.capabilities.nbi_user_config_dir;
  }

  get llmProviders(): [any] {
    return this.capabilities.llm_providers;
  }

  get chatModels(): [any] {
    return this.capabilities.chat_models;
  }

  get inlineCompletionModels(): [any] {
    return this.capabilities.inline_completion_models;
  }

  get defaultChatMode(): string {
    return this.capabilities.default_chat_mode;
  }

  get chatModel(): any {
    return this.capabilities.chat_model;
  }

  get inlineCompletionModel(): any {
    return this.capabilities.inline_completion_model;
  }

  get usingGitHubCopilotModel(): boolean {
    return (
      this.chatModel.provider === GITHUB_COPILOT_PROVIDER_ID ||
      this.inlineCompletionModel.provider === GITHUB_COPILOT_PROVIDER_ID
    );
  }

  get storeGitHubAccessToken(): boolean {
    return this.capabilities.store_github_access_token === true;
  }

  get inlineCompletionDebouncerDelay(): number {
    return Number.isInteger(this.capabilities.inline_completion_debouncer_delay)
      ? this.capabilities.inline_completion_debouncer_delay
      : 200;
  }

  get toolConfig(): any {
    return this.capabilities.tool_config;
  }

  get mcpServers(): any {
    return this.toolConfig.mcpServers;
  }

  getMCPServer(serverId: string): any {
    return this.toolConfig.mcpServers.find(
      (server: any) => server.id === serverId
    );
  }

  getMCPServerPrompt(serverId: string, promptName: string): any {
    const server = this.getMCPServer(serverId);
    if (server) {
      return server.prompts.find((prompt: any) => prompt.name === promptName);
    }
    return null;
  }

  get mcpServerSettings(): any {
    return this.capabilities.mcp_server_settings;
  }

  get claudeSettings(): any {
    return this.capabilities.claude_settings;
  }

  get claudeModels(): IClaudeModelInfo[] {
    return this.capabilities.claude_models ?? [];
  }

  get isInClaudeCodeMode(): boolean {
    return this.claudeSettings.enabled === true;
  }

  get feedbackEnabled(): boolean {
    return this.capabilities.feedback_enabled === true;
  }

  capabilities: any = {};
  chatParticipants: IChatParticipant[] = [];

  changed = new Signal<this, void>(this);
}

export class NBIAPI {
  static _loginStatus = GitHubCopilotLoginStatus.NotLoggedIn;
  static _deviceVerificationInfo: IDeviceVerificationInfo = {
    verificationURI: '',
    userCode: ''
  };
  static _webSocket: WebSocket;
  static _messageReceived = new Signal<unknown, any>(this);
  static config = new NBIConfig();
  static configChanged = this.config.changed;
  static githubLoginStatusChanged = new Signal<unknown, void>(this);
  /**
   * Per-round bookkeeping. Populated by `chatRequest` /
   * `inlineCompletionsRequest` / `generateCode`; drained on `StreamEnd`.
   * Replaces the previous pattern where each request registered its own
   * `_messageReceived.connect` listener that was never disconnected.
   */
  static _activeRounds = new Map<string, IChatRound>();
  /**
   * Tool calls awaiting their `RunUICommandResponse`. Key is
   * `${messageId}:${callbackId}` so we can correlate the result with the
   * `RunUICommand` chunk that started it.
   */
  static _pendingToolCalls = new Map<string, INbiToolCallStarted>();
  /** Set by the `chatObservablePlugin` activation in `index.ts`. */
  static _chatObservable: NbiChatObservable | null = null;

  static setChatObservable(observable: NbiChatObservable): void {
    this._chatObservable = observable;
  }

  static async initialize() {
    await this.fetchCapabilities();
    this.updateGitHubLoginStatus();

    NBIAPI.initializeWebsocket();

    this._messageReceived.connect((_, msg) => {
      msg = JSON.parse(msg);
      if (
        msg.type === BackendMessageType.MCPServerStatusChange ||
        msg.type === BackendMessageType.ClaudeCodeStatusChange
      ) {
        this.fetchCapabilities();
      } else if (
        msg.type === BackendMessageType.GitHubCopilotLoginStatusChange
      ) {
        this.updateGitHubLoginStatus().then(() => {
          this.githubLoginStatusChanged.emit();
        });
      }
      // Route round-scoped messages (every backend reply carries the round
      // `id`). Status messages above have no `id`, so they're ignored here.
      if (typeof msg.id === 'string') {
        const round = this._activeRounds.get(msg.id);
        if (round) {
          this._handleRoundMessage(round, msg);
        }
      }
    });
  }

  /**
   * Dispatcher for messages belonging to an active round.
   *
   * Observable signals fire **before** we forward the message to the
   * round's response emitter. This ordering matters specifically for
   * `RunUICommand`: the consumer (chat-sidebar) is what dispatches the
   * tool call via `app.commands.execute(...)`, and observers (e.g. the
   * LogBook origin tracker) need to know the call is starting *before*
   * the command runs — otherwise the synchronous portion of the command
   * body (setting active cell index, queueing kernel execution, etc.)
   * emits its own signals while no AI window is open.
   *
   * For non-RunUICommand messages the ordering is functionally
   * equivalent, but we keep it uniform so observers always see the
   * lifecycle event before the consumer reacts.
   */
  private static _handleRoundMessage(round: IChatRound, msg: any): void {
    const observable = this._chatObservable;

    if (msg.type === BackendMessageType.StreamMessage) {
      const delta = msg.data?.choices?.[0]?.delta;
      if (typeof delta?.content === 'string') {
        round.textParts.push(delta.content);
      }
      observable?.emitResponseChunk({
        messageId: round.messageId,
        kind: 'text',
        raw: msg
      });
      round.responseEmitter.emit(msg);
      return;
    }

    if (msg.type === BackendMessageType.RunUICommand) {
      const callbackId = msg.data?.callback_id;
      const commandId = msg.data?.commandId;
      const args = msg.data?.args;
      if (
        typeof callbackId === 'string' &&
        typeof commandId === 'string' &&
        observable
      ) {
        const started: INbiToolCallStarted = {
          messageId: round.messageId,
          toolCallId: callbackId,
          commandId,
          args,
          startedAt: performance.now()
        };
        this._pendingToolCalls.set(
          toolCallKey(round.messageId, callbackId),
          started
        );
        observable.emitToolCallStarted(started);
      }
      observable?.emitResponseChunk({
        messageId: round.messageId,
        kind: 'tool_call',
        raw: msg
      });
      round.responseEmitter.emit(msg);
      return;
    }

    if (msg.type === BackendMessageType.StreamEnd) {
      // Any tool calls still pending at this point will never receive a
      // matching `RunUICommandResponse`; mark them abandoned so observers
      // see a paired completion for every started tool call.
      for (const [key, pending] of Array.from(this._pendingToolCalls)) {
        if (pending.messageId !== round.messageId) {
          continue;
        }
        observable?.emitToolCallCompleted({
          messageId: pending.messageId,
          toolCallId: pending.toolCallId,
          commandId: pending.commandId,
          args: pending.args,
          result: null,
          error: 'abandoned',
          durationMs: performance.now() - pending.startedAt
        });
        round.toolCalls.push({
          toolCallId: pending.toolCallId,
          commandId: pending.commandId,
          status: 'abandoned'
        });
        this._pendingToolCalls.delete(key);
      }
      if (!round.cancelled) {
        observable?.emitResponseCompleted({
          messageId: round.messageId,
          text: round.textParts.join(''),
          toolCalls: round.toolCalls,
          durationMs: performance.now() - round.startedAt
        });
      }
      this._activeRounds.delete(round.messageId);
      round.responseEmitter.emit(msg);
      return;
    }

    observable?.emitResponseChunk({
      messageId: round.messageId,
      kind: 'status',
      raw: msg
    });
    round.responseEmitter.emit(msg);
  }

  /**
   * Reports a tool-call result back to the backend, and fires the matching
   * `toolCallCompleted` observable signal. Replaces the previous pattern
   * where chat-sidebar called `sendWebSocketMessage(... RunUICommandResponse ...)`
   * directly, which left the observable blind to results.
   */
  static async completeToolCall(
    messageId: string,
    callbackId: string,
    result: unknown,
    error: string | null
  ): Promise<void> {
    const key = toolCallKey(messageId, callbackId);
    const pending = this._pendingToolCalls.get(key);
    const round = this._activeRounds.get(messageId);

    if (pending && this._chatObservable) {
      this._chatObservable.emitToolCallCompleted({
        messageId: pending.messageId,
        toolCallId: pending.toolCallId,
        commandId: pending.commandId,
        args: pending.args,
        result,
        error,
        durationMs: performance.now() - pending.startedAt
      });
    }
    if (pending) {
      this._pendingToolCalls.delete(key);
      if (round) {
        round.toolCalls.push({
          toolCallId: pending.toolCallId,
          commandId: pending.commandId,
          status: error === null ? 'ok' : 'error'
        });
      }
    }

    // The backend expects a JSON-serializable result. Match the previous
    // chat-sidebar fallback so we don't change the wire contract.
    let safeResult: unknown = result ?? 'void';
    try {
      JSON.stringify(safeResult);
    } catch {
      safeResult = 'Could not serialize the result';
    }

    await this.sendWebSocketMessage(
      messageId,
      RequestDataType.RunUICommandResponse,
      {
        callback_id: callbackId,
        result: safeResult
      }
    );
  }

  static async initializeWebsocket() {
    const serverSettings = ServerConnection.makeSettings();
    const wsUrl = URLExt.join(
      serverSettings.wsUrl,
      'notebook-intelligence',
      'copilot'
    );

    this._webSocket = new serverSettings.WebSocket(wsUrl);
    this._webSocket.onmessage = msg => {
      this._messageReceived.emit(msg.data);
    };

    this._webSocket.onerror = msg => {
      console.error(`Websocket error: ${msg}. Closing...`);
      this._webSocket.close();
    };

    this._webSocket.onclose = msg => {
      console.log(`Websocket is closed: ${msg.reason}. Reconnecting...`);
      setTimeout(() => {
        NBIAPI.initializeWebsocket();
      }, 1000);
    };
  }

  static getLoginStatus(): GitHubCopilotLoginStatus {
    return this._loginStatus;
  }

  static getDeviceVerificationInfo(): IDeviceVerificationInfo {
    return this._deviceVerificationInfo;
  }

  static getGHLoginRequired() {
    return (
      this.config.usingGitHubCopilotModel &&
      NBIAPI.getLoginStatus() === GitHubCopilotLoginStatus.NotLoggedIn
    );
  }

  static getChatEnabled() {
    return (
      this.config.isInClaudeCodeMode ||
      (this.config.chatModel.provider === GITHUB_COPILOT_PROVIDER_ID
        ? !this.getGHLoginRequired()
        : this.config.llmProviders.find(
            provider => provider.id === this.config.chatModel.provider
          ))
    );
  }

  static getInlineCompletionEnabled() {
    return (
      this.config.isInClaudeCodeMode ||
      (this.config.inlineCompletionModel.provider === GITHUB_COPILOT_PROVIDER_ID
        ? !this.getGHLoginRequired()
        : this.config.llmProviders.find(
            provider =>
              provider.id === this.config.inlineCompletionModel.provider
          ))
    );
  }

  static async loginToGitHub() {
    this._loginStatus = GitHubCopilotLoginStatus.ActivatingDevice;
    return new Promise((resolve, reject) => {
      requestAPI<any>('gh-login', { method: 'POST' })
        .then(data => {
          resolve({
            verificationURI: data.verification_uri,
            userCode: data.user_code
          });
          this.updateGitHubLoginStatus();
        })
        .catch(reason => {
          console.error(`Failed to login to GitHub Copilot.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async logoutFromGitHub() {
    this._loginStatus = GitHubCopilotLoginStatus.ActivatingDevice;
    return new Promise((resolve, reject) => {
      requestAPI<any>('gh-logout', { method: 'GET' })
        .then(data => {
          this.updateGitHubLoginStatus().then(() => {
            resolve(data);
          });
        })
        .catch(reason => {
          console.error(`Failed to logout from GitHub Copilot.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async updateGitHubLoginStatus() {
    return new Promise<void>((resolve, reject) => {
      requestAPI<any>('gh-login-status')
        .then(response => {
          this._loginStatus = response.status;
          this._deviceVerificationInfo.verificationURI =
            response.verification_uri || '';
          this._deviceVerificationInfo.userCode = response.user_code || '';
          resolve();
        })
        .catch(reason => {
          console.error(
            `Failed to fetch GitHub Copilot login status.\n${reason}`
          );
          reject(reason);
        });
    });
  }

  static async fetchCapabilities(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      requestAPI<any>('capabilities', { method: 'GET' })
        .then(data => {
          const oldConfig = {
            capabilities: structuredClone(this.config.capabilities),
            chatParticipants: structuredClone(this.config.chatParticipants)
          };
          this.config.capabilities = structuredClone(data);
          this.config.chatParticipants = structuredClone(
            data.chat_participants
          );
          const newConfig = {
            capabilities: structuredClone(this.config.capabilities),
            chatParticipants: structuredClone(this.config.chatParticipants)
          };
          if (JSON.stringify(newConfig) !== JSON.stringify(oldConfig)) {
            this.configChanged.emit();
          }
          resolve();
        })
        .catch(reason => {
          console.error(`Failed to get extension capabilities.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async setConfig(config: any) {
    requestAPI<any>('config', {
      method: 'POST',
      body: JSON.stringify(config)
    })
      .then(data => {
        NBIAPI.fetchCapabilities();
      })
      .catch(reason => {
        console.error(`Failed to set NBI config.\n${reason}`);
      });
  }

  static async updateOllamaModelList(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      requestAPI<any>('update-provider-models', {
        method: 'POST',
        body: JSON.stringify({ provider: 'ollama' })
      })
        .then(async data => {
          await NBIAPI.fetchCapabilities();
          resolve();
        })
        .catch(reason => {
          console.error(`Failed to update ollama model list.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async updateClaudeModelList(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      requestAPI<any>('update-provider-models', {
        method: 'POST',
        body: JSON.stringify({ provider: 'claude' })
      })
        .then(async data => {
          await NBIAPI.fetchCapabilities();
          resolve();
        })
        .catch(reason => {
          console.error(`Failed to update Claude model list.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async getMCPConfigFile(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      requestAPI<any>('mcp-config-file', { method: 'GET' })
        .then(async data => {
          resolve(data);
        })
        .catch(reason => {
          console.error(`Failed to get MCP config file.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async setMCPConfigFile(config: any): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      requestAPI<any>('mcp-config-file', {
        method: 'POST',
        body: JSON.stringify(config)
      })
        .then(async data => {
          resolve(data);
        })
        .catch(reason => {
          console.error(`Failed to set MCP config file.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async chatRequest(
    messageId: string,
    chatId: string,
    prompt: string,
    language: string,
    currentDirectory: string,
    filename: string,
    additionalContext: IContextItem[],
    chatMode: string,
    toolSelections: IToolSelections,
    responseEmitter: IChatCompletionResponseEmitter
  ) {
    const startedAt = performance.now();
    this._activeRounds.set(messageId, {
      messageId,
      chatId,
      mode: 'chat',
      responseEmitter,
      startedAt,
      textParts: [],
      toolCalls: [],
      cancelled: false
    });
    this._chatObservable?.emitRequestStarted({
      messageId,
      chatId,
      mode: 'chat',
      prompt,
      language,
      filename,
      additionalContext,
      toolSelections,
      startedAt
    });
    this._webSocket.send(
      JSON.stringify({
        id: messageId,
        type: RequestDataType.ChatRequest,
        data: {
          chatId,
          prompt,
          language,
          currentDirectory,
          filename,
          additionalContext,
          chatMode,
          toolSelections
        }
      })
    );
  }

  static async reloadMCPServers(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      requestAPI<any>('reload-mcp-servers', { method: 'POST' })
        .then(async data => {
          await NBIAPI.fetchCapabilities();
          resolve(data);
        })
        .catch(reason => {
          console.error(`Failed to reload MCP servers.\n${reason}`);
          reject(reason);
        });
    });
  }

  static async generateCode(
    chatId: string,
    prompt: string,
    prefix: string,
    suffix: string,
    existingCode: string,
    language: string,
    filename: string,
    responseEmitter: IChatCompletionResponseEmitter
  ) {
    const messageId = UUID.uuid4();
    const startedAt = performance.now();
    this._activeRounds.set(messageId, {
      messageId,
      chatId,
      mode: 'generate-code',
      responseEmitter,
      startedAt,
      textParts: [],
      toolCalls: [],
      cancelled: false
    });
    this._chatObservable?.emitRequestStarted({
      messageId,
      chatId,
      mode: 'generate-code',
      prompt,
      language,
      filename,
      additionalContext: [],
      startedAt
    });
    this._webSocket.send(
      JSON.stringify({
        id: messageId,
        type: RequestDataType.GenerateCode,
        data: {
          chatId,
          prompt,
          prefix,
          suffix,
          existingCode,
          language,
          filename
        }
      })
    );
  }

  static async sendChatUserInput(messageId: string, data: any) {
    this._webSocket.send(
      JSON.stringify({
        id: messageId,
        type: RequestDataType.ChatUserInput,
        data
      })
    );
  }

  static async sendWebSocketMessage(
    messageId: string,
    messageType: RequestDataType,
    data: any
  ) {
    if (
      messageType === RequestDataType.CancelChatRequest ||
      messageType === RequestDataType.CancelInlineCompletionRequest
    ) {
      const round = this._activeRounds.get(messageId);
      if (round) {
        round.cancelled = true;
        this._chatObservable?.emitRequestCancelled({ messageId });
      }
    }
    this._webSocket.send(
      JSON.stringify({ id: messageId, type: messageType, data })
    );
  }

  static async inlineCompletionsRequest(
    chatId: string,
    messageId: string,
    prefix: string,
    suffix: string,
    language: string,
    filename: string,
    responseEmitter: IChatCompletionResponseEmitter
  ) {
    const startedAt = performance.now();
    this._activeRounds.set(messageId, {
      messageId,
      chatId,
      mode: 'inline',
      responseEmitter,
      startedAt,
      textParts: [],
      toolCalls: [],
      cancelled: false
    });
    this._chatObservable?.emitRequestStarted({
      messageId,
      chatId,
      mode: 'inline',
      prompt: prefix,
      language,
      filename,
      additionalContext: [],
      startedAt
    });
    this._webSocket.send(
      JSON.stringify({
        id: messageId,
        type: RequestDataType.InlineCompletionRequest,
        data: {
          chatId,
          prefix,
          suffix,
          language,
          filename
        }
      })
    );
  }

  static async emitTelemetryEvent(event: ITelemetryEvent): Promise<void> {
    const assistantMode = this.config.isInClaudeCodeMode
      ? AssistantMode.Claude
      : AssistantMode.Default;

    event.data = {
      ...(event.data || {}),
      assistantMode
    };

    return new Promise<void>((resolve, reject) => {
      requestAPI<any>('emit-telemetry-event', {
        method: 'POST',
        body: JSON.stringify(event)
      })
        .then(async data => {
          resolve();
        })
        .catch(reason => {
          console.error(`Failed to emit telemetry event.\n${reason}`);
          reject(reason);
        });
    });
  }
}
