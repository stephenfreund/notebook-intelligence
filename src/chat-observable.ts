// Copyright (c) Mehmet Bektas <mbektasgh@outlook.com>

/**
 * Implementation of {@link INbiChatObservable}. A singleton is created by
 * `chatObservablePlugin` (in `index.ts`) and handed to `NBIAPI` so the
 * websocket layer can fire signals as rounds progress.
 *
 * The class is intentionally a thin signal hub: it owns no policy of its
 * own. `NBIAPI` decides when each signal fires and what payload to attach.
 */

import { ISignal, Signal } from '@lumino/signaling';

import {
  INbiChatObservable,
  INbiChatRequestCancelled,
  INbiChatRequestFailed,
  INbiChatRequestStarted,
  INbiChatResponseChunk,
  INbiChatResponseCompleted,
  INbiToolCallCompleted,
  INbiToolCallStarted
} from './tokens';

export class NbiChatObservable implements INbiChatObservable {
  get requestStarted(): ISignal<INbiChatObservable, INbiChatRequestStarted> {
    return this._requestStarted;
  }
  get responseChunk(): ISignal<INbiChatObservable, INbiChatResponseChunk> {
    return this._responseChunk;
  }
  get responseCompleted(): ISignal<
    INbiChatObservable,
    INbiChatResponseCompleted
  > {
    return this._responseCompleted;
  }
  get requestCancelled(): ISignal<
    INbiChatObservable,
    INbiChatRequestCancelled
  > {
    return this._requestCancelled;
  }
  get requestFailed(): ISignal<INbiChatObservable, INbiChatRequestFailed> {
    return this._requestFailed;
  }
  get toolCallStarted(): ISignal<INbiChatObservable, INbiToolCallStarted> {
    return this._toolCallStarted;
  }
  get toolCallCompleted(): ISignal<INbiChatObservable, INbiToolCallCompleted> {
    return this._toolCallCompleted;
  }

  emitRequestStarted(payload: INbiChatRequestStarted): void {
    this._requestStarted.emit(payload);
  }
  emitResponseChunk(payload: INbiChatResponseChunk): void {
    this._responseChunk.emit(payload);
  }
  emitResponseCompleted(payload: INbiChatResponseCompleted): void {
    this._responseCompleted.emit(payload);
  }
  emitRequestCancelled(payload: INbiChatRequestCancelled): void {
    this._requestCancelled.emit(payload);
  }
  emitRequestFailed(payload: INbiChatRequestFailed): void {
    this._requestFailed.emit(payload);
  }
  emitToolCallStarted(payload: INbiToolCallStarted): void {
    this._toolCallStarted.emit(payload);
  }
  emitToolCallCompleted(payload: INbiToolCallCompleted): void {
    this._toolCallCompleted.emit(payload);
  }

  private readonly _requestStarted = new Signal<this, INbiChatRequestStarted>(
    this
  );
  private readonly _responseChunk = new Signal<this, INbiChatResponseChunk>(
    this
  );
  private readonly _responseCompleted = new Signal<
    this,
    INbiChatResponseCompleted
  >(this);
  private readonly _requestCancelled = new Signal<
    this,
    INbiChatRequestCancelled
  >(this);
  private readonly _requestFailed = new Signal<this, INbiChatRequestFailed>(
    this
  );
  private readonly _toolCallStarted = new Signal<this, INbiToolCallStarted>(
    this
  );
  private readonly _toolCallCompleted = new Signal<this, INbiToolCallCompleted>(
    this
  );
}
