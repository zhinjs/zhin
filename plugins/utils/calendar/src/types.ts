/** Calendar event as returned by every provider. */
export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly location?: string;
  readonly description?: string;
  readonly all_day?: boolean;
}

export interface CreateEventInput {
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly location?: string;
  readonly description?: string;
  readonly all_day?: boolean;
}

export interface FreeSlot {
  readonly start: string;
  readonly end: string;
}

export interface CalendarProvider {
  readonly name: string;
  listEvents(
    from: Date,
    to: Date,
    signal?: AbortSignal
  ): Promise<CalendarEvent[]>;
  createEvent(
    input: CreateEventInput,
    signal?: AbortSignal
  ): Promise<CalendarEvent>;
}
