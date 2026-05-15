// Copyright (c) Mehmet Bektas <mbektasgh@outlook.com>

import { Widget } from '@lumino/widgets';
import { CodeEditor } from '@jupyterlab/codeeditor';
import { Token } from '@lumino/coreutils';
import { ISignal } from '@lumino/signaling';

export interface IActiveDocumentInfo {
  activeWidget: Widget | null;
  language: string;
  filename: string;
  filePath: string;
  activeCellIndex: number;
  selection?: CodeEditor.IRange;
}

export interface IChatCompletionResponseEmitter {
  emit: (response: any) => void;
}

export enum RequestDataType {
  ChatRequest = 'chat-request',
  ChatUserInput = 'chat-user-input',
  ClearChatHistory = 'clear-chat-history',
  RunUICommandResponse = 'run-ui-command-response',
  GenerateCode = 'generate-code',
  CancelChatRequest = 'cancel-chat-request',
  InlineCompletionRequest = 'inline-completion-request',
  CancelInlineCompletionRequest = 'cancel-inline-completion-request'
}

export enum BackendMessageType {
  StreamMessage = 'stream-message',
  StreamEnd = 'stream-end',
  RunUICommand = 'run-ui-command',
  GitHubCopilotLoginStatusChange = 'github-copilot-login-status-change',
  MCPServerStatusChange = 'mcp-server-status-change',
  ClaudeCodeStatusChange = 'claude-code-status-change'
}

export enum ResponseStreamDataType {
  LLMRaw = 'llm-raw',
  Markdown = 'markdown',
  MarkdownPart = 'markdown-part',
  Image = 'image',
  HTMLFrame = 'html-frame',
  Button = 'button',
  Anchor = 'anchor',
  Progress = 'progress',
  Confirmation = 'confirmation',
  AskUserQuestion = 'ask-user-question'
}

export enum ContextType {
  Custom = 'custom',
  CurrentFile = 'current-file'
}

export enum MCPServerStatus {
  NotConnected = 'not-connected',
  Connecting = 'connecting',
  Disconnecting = 'disconnecting',
  FailedToConnect = 'failed-to-connect',
  Connected = 'connected',
  UpdatingToolList = 'updating-tool-list',
  UpdatedToolList = 'updated-tool-list',
  UpdatingPromptList = 'updating-prompt-list',
  UpdatedPromptList = 'updated-prompt-list'
}

export interface IContextItem {
  type: ContextType;
  content: string;
  currentCellContents: ICellContents;
  filePath?: string;
  cellIndex?: number;
  startLine?: number;
  endLine?: number;
}

export interface ICellContents {
  input: string;
  output: string;
}

export interface IChatParticipant {
  id: string;
  name: string;
  description: string;
  iconPath: string;
  commands: string[];
}

export interface IToolSelections {
  builtinToolsets?: string[];
  mcpServers?: {
    [key: string]: string[];
  };
  extensions?: {
    [key: string]: string[];
  };
}

export enum BuiltinToolsetType {
  NotebookEdit = 'nbi-notebook-edit',
  NotebookExecute = 'nbi-notebook-execute',
  PythonFileEdit = 'nbi-python-file-edit',
  FileEdit = 'nbi-file-edit',
  FileRead = 'nbi-file-read',
  CommandExecute = 'nbi-command-execute'
}

export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot';
export const CLAUDE_CODE_CHAT_PARTICIPANT_ID = 'claude-code';

export enum AssistantMode {
  Default = 'default',
  Claude = 'claude'
}

export enum TelemetryEventType {
  InlineCompletionRequest = 'inline-completion-request',
  ExplainThisRequest = 'explain-this-request',
  FixThisCodeRequest = 'fix-this-code-request',
  ExplainThisOutputRequest = 'explain-this-output-request',
  TroubleshootThisOutputRequest = 'troubleshoot-this-output-request',
  GenerateCodeRequest = 'generate-code-request',
  ChatRequest = 'chat-request',
  InlineChatRequest = 'inline-chat-request',
  ChatResponse = 'chat-response',
  InlineChatResponse = 'inline-chat-response',
  InlineCompletionResponse = 'inline-completion-response',
  Feedback = 'feedback'
}

export interface ITelemetryEvent {
  type: TelemetryEventType;
  data?: any;
}

export interface ITelemetryListener {
  get name(): string;
  onTelemetryEvent: (event: ITelemetryEvent) => void;
}

export interface ITelemetryEmitter {
  emitTelemetryEvent(event: ITelemetryEvent): void;
}

export const INotebookIntelligence = new Token<INotebookIntelligence>(
  '@notebook-intelligence/notebook-intelligence:INotebookIntelligence',
  'AI coding assistant for JupyterLab.'
);

export interface INotebookIntelligence {
  registerTelemetryListener: (listener: ITelemetryListener) => void;
  unregisterTelemetryListener: (listener: ITelemetryListener) => void;
}

/**
 * Observable lifecycle for chat rounds and tool calls dispatched by NBI.
 *
 * Surfaces both the inputs (prompt, context, tool selections) and outputs
 * (final response text, tool-call args/results) of every chat/inline/generate
 * round NBI runs. External extensions (e.g. logging tools) consume these
 * signals to record what the AI did without poking at NBI's internals.
 *
 * Visibility caveat: this surfaces tool calls that flow through the
 * frontend's `run-ui-command` path. Tools that NBI executes purely
 * server-side without round-tripping the frontend will not appear here.
 */
export type NbiChatMode = 'chat' | 'inline' | 'generate-code';

export interface INbiChatRequestStarted {
  /** Per-round identifier. Use as the correlation id across all events. */
  messageId: string;
  /** Conversation-level identifier; stable across rounds in the same chat. */
  chatId: string;
  mode: NbiChatMode;
  prompt: string;
  language?: string;
  filename?: string;
  additionalContext: IContextItem[];
  toolSelections?: IToolSelections;
  startedAt: number;
}

export interface INbiChatResponseChunk {
  messageId: string;
  kind: 'text' | 'tool_call' | 'status';
  /** Parsed websocket message. Shape varies by `kind`. */
  raw: unknown;
}

export interface INbiChatToolCallSummary {
  toolCallId: string;
  commandId: string;
  status: 'ok' | 'error' | 'abandoned';
}

export interface INbiChatResponseCompleted {
  messageId: string;
  /** Accumulated text content from all StreamMessage chunks. */
  text: string;
  toolCalls: INbiChatToolCallSummary[];
  durationMs: number;
}

export interface INbiChatRequestCancelled {
  messageId: string;
  reason?: string;
}

export interface INbiChatRequestFailed {
  messageId: string;
  error: string;
}

export interface INbiToolCallStarted {
  /** Round this tool call belongs to. */
  messageId: string;
  /** Unique per tool call within a round. Matches `callback_id` on the wire. */
  toolCallId: string;
  /** The JupyterLab command id the AI invoked. */
  commandId: string;
  /** Args object as passed to `app.commands.execute(...)`. */
  args: unknown;
  startedAt: number;
}

export interface INbiToolCallCompleted {
  messageId: string;
  toolCallId: string;
  commandId: string;
  args: unknown;
  /** Whatever the command returned. `'void'` (string) if undefined. */
  result: unknown;
  /** Stringified exception if `app.commands.execute` threw, else null. */
  error: string | null;
  durationMs: number;
}

export interface INbiChatObservable {
  readonly requestStarted: ISignal<INbiChatObservable, INbiChatRequestStarted>;
  readonly responseChunk: ISignal<INbiChatObservable, INbiChatResponseChunk>;
  readonly responseCompleted: ISignal<
    INbiChatObservable,
    INbiChatResponseCompleted
  >;
  readonly requestCancelled: ISignal<
    INbiChatObservable,
    INbiChatRequestCancelled
  >;
  readonly requestFailed: ISignal<INbiChatObservable, INbiChatRequestFailed>;
  readonly toolCallStarted: ISignal<INbiChatObservable, INbiToolCallStarted>;
  readonly toolCallCompleted: ISignal<
    INbiChatObservable,
    INbiToolCallCompleted
  >;
}

export const INbiChatObservable = new Token<INbiChatObservable>(
  '@notebook-intelligence/notebook-intelligence:INbiChatObservable',
  'Observable lifecycle of NBI chat rounds and tool calls.'
);
