import { AxiosError } from 'axios';

type EventListener = (...args: any[]) => void;

export class EventEmitter {
  private events: Record<string, EventListener[]>;

  constructor() {
    this.events = {};
  }

  /**
   * Subscribe to an event
   * @param event The event name to subscribe to
   * @param listener The callback function to execute when the event is emitted
   * @returns void
   */
  on(event: string, listener: EventListener): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  /**
   * Unsubscribe from an event
   * @param event The event name to unsubscribe from
   * @param listener The callback function to remove
   * @returns void
   */
  off(event: string, listener: EventListener): void {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter((l) => l !== listener);
  }

  /**
   * Emit an event
   * @param event The event name to emit
   * @param args Arguments to pass to the event listeners
   * @returns void
   */
  emit(event: string, ...args: any[]): void {
    if (!this.events[event]) return;
    this.events[event].forEach((listener) => listener(...args));
  }
}

export const handleAxiosError = (error: AxiosError) => {
  console.log({
    code: error.code,
    url: error.response?.config.url,
    data: error.response?.config.data,
    status: error.response?.status,
    message: error.response?.statusText,
    details: error.response?.data
  });
};
