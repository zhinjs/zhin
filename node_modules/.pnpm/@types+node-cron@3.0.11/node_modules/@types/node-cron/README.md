# Installation
> `npm install --save @types/node-cron`

# Summary
This package contains type definitions for node-cron (https://github.com/node-cron/node-cron).

# Details
Files were exported from https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node-cron.
## [index.d.ts](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node-cron/index.d.ts)
````ts
import { EventEmitter } from "events";

/**
 * Creates a new task to execute the given function when the cron expression ticks.
 * @param cronExpression
 * @param func
 * @param options
 */
export function schedule(
    cronExpression: string,
    func: ((now: Date | "manual" | "init") => void) | string,
    options?: ScheduleOptions,
): ScheduledTask;

/**
 * To validate whether the expression is a cron expression or not
 * @param cronExpression
 */
export function validate(cronExpression: string): boolean;

/**
 * Get the list of tasks created using the `schedule` function
 */
export function getTasks(): Map<string, ScheduledTask>;

export interface ScheduledTask extends EventEmitter {
    now: (now?: Date) => void;
    start: () => void;
    stop: () => void;
}

export interface ScheduleOptions {
    /**
     * A boolean to set if the created task is scheduled.
     *
     * Defaults to `true`
     */
    scheduled?: boolean | undefined;
    /**
     * The timezone that is used for job scheduling
     */
    timezone?: string;
    /**
     * Specifies whether to recover missed executions instead of skipping them.
     *
     * Defaults to `false`
     */
    recoverMissedExecutions?: boolean;
    /**
     * The schedule name
     */
    name?: string;
    /**
     * Execute task immediately after creation
     */
    runOnInit?: boolean;
}

````

### Additional Details
 * Last updated: Tue, 07 Nov 2023 20:08:00 GMT
 * Dependencies: none

# Credits
These definitions were written by [morsic](https://github.com/maximelkin), [burtek](https://github.com/burtek), [Richard Honor](https://github.com/RMHonor), [Ata Berk YILMAZ](https://github.com/ataberkylmz), [Alex Seidmann](https://github.com/aseidma), and [Pedro Américo](https://github.com/ghostebony).
