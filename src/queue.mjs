import { randomUUID } from 'node:crypto';
import { BrokerError } from './errors.mjs';

export class LeaseQueue {
  constructor(config, telemetry, options = {}) {
    this.config = config;
    this.telemetry = telemetry;
    this.entries = [];
    this.onChange = options.onChange || (() => {});
  }

  get length() {
    return this.entries.length;
  }

  enqueue(request) {
    if (this.entries.length >= (this.config.queueMaxDepth || 10)) {
      throw new BrokerError('RESOURCE', 'QUEUE_FULL', 'The session queue is full.', undefined, 429);
    }
    const id = randomUUID();
    const waitTimeoutMs = request.waitTimeoutMs ?? this.config.queueWaitTimeoutMs ?? 30000;
    if (request.signal?.aborted) {
      throw new BrokerError('RESOURCE', 'QUEUE_CANCELLED', 'Queue request was cancelled.', undefined, 499);
    }
    
    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.cancel(id, new BrokerError('RESOURCE', 'QUEUE_TIMEOUT', 'Timed out waiting for session capacity.', undefined, 408));
      }, waitTimeoutMs);
      
      const entry = {
        id,
        clientId: request.clientId,
        authProfileId: request.authProfileId,
        poolId: request.poolId || null,
        taskLabel: request.taskLabel,
        enqueuedAt: Date.now(),
        initialPosition: this.entries.length + 1,
        waitTimeoutMs,
        resolve,
        reject,
        timeoutId,
        signal: request.signal,
        abortListener: null
      };
      if (request.signal) {
        entry.abortListener = () => this.cancel(id);
        request.signal.addEventListener('abort', entry.abortListener, { once: true });
      }
      this.entries.push(entry);
      this.telemetry.event('queue_joined', { 
        clientId: request.clientId, 
        authProfileId: request.authProfileId, 
        queuePosition: this.entries.length,
        queueLength: this.entries.length,
        waitTimeoutMs,
        metadata: { queue_id: id }
      });
    });
    // Keep the promise directly awaitable while exposing its non-secret queue
    // identifier for explicit cancellation/status plumbing.
    promise.id = id;
    promise.promise = promise;
    return promise;
  }

  peek() {
    return this.entries[0] || null;
  }

  takeHead(predicate = () => true) {
    const entry = this.peek();
    if (!entry || !predicate(entry)) return null;
    this.entries.shift();
    clearTimeout(entry.timeoutId);
    if (entry.signal && entry.abortListener) entry.signal.removeEventListener('abort', entry.abortListener);
    this.telemetry.event('queue_position_changed', {
      clientId: entry.clientId,
      authProfileId: entry.authProfileId,
      queuePosition: 0,
      queueLength: this.entries.length,
      waitTimeoutMs: entry.waitTimeoutMs,
      metadata: { queue_id: entry.id, state: 'PROMOTING' }
    });
    this.#emitPositions();
    return entry;
  }

  resolve(entry, value) {
    this.telemetry.event('queue_promoted', {
      clientId: entry.clientId,
      authProfileId: entry.authProfileId,
      queuePosition: entry.initialPosition,
      queueLength: this.entries.length,
      queueWaitMs: Date.now() - entry.enqueuedAt,
      waitTimeoutMs: entry.waitTimeoutMs,
      metadata: { queue_id: entry.id }
    });
    entry.resolve(value);
  }

  cancel(id, reasonError) {
    const index = this.entries.findIndex(e => e.id === id);
    if (index >= 0) {
      const [entry] = this.entries.splice(index, 1);
      clearTimeout(entry.timeoutId);
      if (entry.signal && entry.abortListener) entry.signal.removeEventListener('abort', entry.abortListener);
      const error = reasonError || new BrokerError('RESOURCE', 'QUEUE_CANCELLED', 'Queue request was cancelled.', undefined, 499);
      this.telemetry.event(error.code === 'QUEUE_TIMEOUT' ? 'queue_timeout' : 'queue_cancelled', { 
        clientId: entry.clientId, 
        authProfileId: entry.authProfileId, 
        errorCategory: error.category, 
        errorCode: error.code, 
        queuePosition: index + 1,
        queueLength: this.entries.length,
        queueWaitMs: Date.now() - entry.enqueuedAt,
        waitTimeoutMs: entry.waitTimeoutMs,
        metadata: { queue_id: entry.id }
      });
      entry.reject(error);
      this.#emitPositions();
      queueMicrotask(() => this.onChange());
      return true;
    }
    return false;
  }

  drain() {
    while (this.entries.length > 0) {
      this.cancel(this.entries[0].id, new BrokerError('RESOURCE', 'QUEUE_CANCELLED', 'Broker is shutting down.', undefined, 503));
    }
  }

  position(id) {
    const index = this.entries.findIndex(entry => entry.id === id);
    return index < 0 ? null : index + 1;
  }

  #emitPositions() {
    this.entries.forEach((entry, index) => {
      this.telemetry.event('queue_position_changed', {
        clientId: entry.clientId,
        authProfileId: entry.authProfileId,
        queuePosition: index + 1,
        queueLength: this.entries.length,
        waitTimeoutMs: entry.waitTimeoutMs,
        metadata: { queue_id: entry.id }
      });
    });
  }
}
