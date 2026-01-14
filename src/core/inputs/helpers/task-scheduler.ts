/**
 * Load dependencies
 */
// @ts-ignore
import later from '@breejs/later';
import { ScheduleData, Timer } from '../../types/helpers/later-overrides';
import { ILogger } from '../../../types';

export interface ScheduleConfig {
  /**
   * defaultPerTaskConcurrency
   * The idea behind this property is to control how many of the same task can run at the same time.
   * For example,
   * If you have a task that is scheduled every second but it takes 10 seconds to complete
   *  then you might have 10 of the same task running at the same time
   * This may be ok or you may only want 1 single instance of any task to run at the same time.
   **/
  defaultPerTaskConcurrency?: number; // Default per task concurrency. (Default to Infinity)
  /**
   * defaultMaxPerTaskQueueLength
   * The way task managment works is by using a queue. This controls how large the task queue can be.
   * If a task interval goes off while an existing task is running and concurrency is already limited
   *  then your task queue may grow.
   * This variable controls the max length of that queue
   **/
  defaultMaxPerTaskQueueLength?: number; // Default to Infinity
  timezoneConfig?: 'local' | 'utc' | string; // Local or utc time (Defaults to utc)
  tasks: TaskConfig[]; // List of tasks
}
export interface TaskConfig {
  name: string;
  /**
   * The way task managment works is by using a queue. This controls how large the task queue can be.
   * If a task interval goes off while an existing task is running and concurrency is already limited
   *  then your task queue may grow.
   * This variable controls the max length of that queue
   * This controls the max queue length for the current task whereas the top level defaultMaxPerTaskQueueLength controls the default value
   **/
  maxTaskQueueLength?: number | null; // Queue length for task queue
  /**
   * The idea behind this property is to control how many of the same task can run at the same time.
   * For example,
   * If you have a task that is scheduled every second but it takes 10 seconds to complete
   *  then you might have 10 of the same task running at the same time
   * This may be ok or you may only want 1 single instance of any task to run at the same time.
   * This controls the concurrency limit for this task whereas the top level defaultPerTaskConcurrency controls the default value
   **/
  concurrency?: number | null; // Allowed, concurrency for this task
  intervalText?: string | null;
  intervalCron?: string | null;
  input?: any; // Arbitrary input to be passed to the rules engine
}

export interface Task {
  name: string;
  maxTaskQueueLength: number;
  concurrency: number;
  promiseQueue?: any;
  schedule: ScheduleData;
  taskConfig: TaskConfig;
  handle?: Timer | null;
  input?: any;
}

// This is a simple abstraction to help manage repeated tasks
export default class TaskScheduler {
  private logger?: ILogger;
  private schedulerConfig: ScheduleConfig;
  private taskList: Task[];
  private isStarted: boolean;
  private specificTimezone?: string;
  private scheduledFn: (task: Task) => Promise<any>;

  /**
   * Constructor for the TaskScheduler
   * @param {logger, schedulerConfig} - a logger so this class can log
   * @constructor
   */
  constructor({
    logger,
    schedulerConfig,
    scheduledFn,
  }: {
    logger?: ILogger;
    schedulerConfig: ScheduleConfig;
    scheduledFn: (task: Task) => any;
  }) {
    this.logger = logger;
    this.schedulerConfig = schedulerConfig;
    this.scheduledFn = scheduledFn;
    this.logger?.debug('TaskScheduler -> constructor');

    switch ((schedulerConfig.timezoneConfig || 'utc').toLowerCase()) {
      case 'local':
        later.date.localTime();
        break;
      case 'utc':
        later.date.UTC();
        break;
      default:
        later.date.localTime();
        this.specificTimezone = schedulerConfig.timezoneConfig;
        break;
    }

    // Initialize task list
    this.taskList = [];
    this.isStarted = false;
  }

  /**
   * start - This must be called before the tasks actually start running
   *
   * @params none
   * return undefined
   **/
  start() {
    // Start the scheduler
    if (!this.isStarted) {
      this.logger?.debug('TaskScheduler -> start - Starting all tasks');

      // Add configured tasks to to our internal task list
      for (let idx in this.schedulerConfig.tasks) {
        this._addToInternalTaskList(this.schedulerConfig.tasks[idx]);
      }

      // Schedule the actual tasks
      for (let idx in this.taskList) {
        this._scheduleTask(this.taskList[idx]);
      }
      this.isStarted = true;
    } else {
      this.logger?.debug('TaskScheduler -> start - Tasks already started');
    }
  }

  /**
   * stop - This is called to stop the scheduler
   *
   * @params none
   * return undefined
   **/
  async stop() {
    // Start the scheduler
    if (this.isStarted) {
      this.logger?.debug('TaskScheduler -> start - Stopping all tasks');

      // Schedule the actual tasks
      let allPromiseQueues = [];
      for (let idx in this.taskList) {
        this.taskList[idx]?.handle?.clear();
        allPromiseQueues.push(this.taskList[idx].promiseQueue.onIdle());
      }
      // Wait for all tasks to complete
      await Promise.all(allPromiseQueues);
      this.isStarted = false;
    } else {
      this.logger?.debug('TaskScheduler -> start - Tasks already stopped');
    }
  }

  /**
   * Schedule a task - This should be called from the start function and not externally
   * Does this by calling an interval timer using the later.js library
   *
   * @params task    - Object with the task config (name/schedule/taskFn/skipIfBackup)
   * return undefined
   **/
  private _scheduleTask(task: Task) {
    this.logger?.debug(
      'TaskScheduler -> _scheduleTask - Scheduling task: ',
      task.name
    );

    // Later js is a library for starting tasks at deterministic times (ie start of the hour, min or second)
    // Store the schedule handle just in-case we decide to stop tasks at some
    // later date (also useful for test cleanup)
    if (task.schedule) {
      task.handle = later.setInterval(() => {
        // Add task to the queue to make sure we only run 1 of the same task at a time
        this._addToTaskQueue(task);
      }, task.schedule, this.specificTimezone);
    }
  }

  /**
   * Add to the task's promise queue
   *
   * @params task - Object with the task config (name/schedule/taskFn/skipIfBackup/promiseQueue)
   ***/
  private async _addToTaskQueue(task: Task) {
    if (!task.promiseQueue) {
      // NOTE: p-queue is a es module - To use esm within commonjs module, you have to do a dynamic import. Unfortunatly, dynamic
      // imports are converted to require in typescript. Eval is a work around to force this to use a dynamic import even within typescript
      const { default: PQueue } = await (eval('import("p-queue")') as Promise<
        typeof import('p-queue')
      >);
      task.promiseQueue = new PQueue({ concurrency: task.concurrency });
    }
    // Add task to the promise queue
    if (task.promiseQueue) {
      if (task.promiseQueue.size > task.maxTaskQueueLength) {
        this.logger?.error(
          `TaskScheduler -> Task Error: Queue length exeeeded maximum size of ${task.maxTaskQueueLength} for task `
        );
        return;
      }

      try {
        await task.promiseQueue.add(async () => {
          // Just to log the start of the task
          this.logger?.info(`TaskScheduler -> Task Starting: ${task.name}`);

          await this.scheduledFn(task);
        });
        // Log the task successfully completed
        this.logger?.info(
          `TaskScheduler -> Task Successfully run: ${task.name}`
        );
      } catch (err) {
        // Log task error
        this.logger?.info(`TaskScheduler -> Task: ${task.name} - Error: `, err);
      }
    }
  }

  /**
   * This function is intended for internal use only.
   * It takes a task config from conf/task-scheduler.json
   *
   * @params taskConfig    - Object with task name and schedule config
   *                         and file with class that has a static execute funciton
   * return undefined      - Or throws error if it fails
   ***/
  private _addToInternalTaskList(taskConfig: TaskConfig) {
    try {
      this.logger?.debug(
        'TaskScheduler -> _addToInternalTaskList - Adding task: ',
        taskConfig.name
      );

      let taskConcurrency =
        taskConfig.concurrency ||
        this.schedulerConfig.defaultPerTaskConcurrency ||
        Infinity;

      // Create the later.js schedule
      let schedule: ScheduleData;
      if (taskConfig.intervalText) {
        // Using the text parser
        schedule = later.parse.text(taskConfig.intervalText);
      } else if (taskConfig.intervalCron) {
        // Using the cron parser
        schedule = later.parse.cron(taskConfig.intervalCron);
      } else {
        throw new Error('Invalid schedule');
      }

    // This next blob came from the later.js library to calculate the real next value for a given timezone
    // this is a workaround for the library only partially supporting timezones
    // Specifically setInterval and setTimeout support timezones but next does not
    const next = (() => {
      const date = new Date();
      const now = date.getTime();
      const s = later.schedule(schedule);
      const timezone = this.specificTimezone;
      if (!timezone || ['local', 'system'].includes(timezone)) {
        return s.next(2, now);
      }

      const localOffsetMillis = date.getTimezoneOffset() * 6e4;
      const offsetMillis = this._getOffset(date, timezone);

      // Specified timezone has the same offset as local timezone.
      // ie. America/New_York = America/Nassau = GMT-4
      if (offsetMillis === localOffsetMillis) {
        return s.next(2, now);
      }

      // Offsets differ, adjust current time to match what
      // it should've been for the specified timezone.
      const adjustedNow = new Date(now + localOffsetMillis - offsetMillis);

      return (s.next(2, adjustedNow) as Date[] || /* istanbul ignore next */ []).map(
        (sched: any) => {
          // adjust scheduled times to match their intended timezone
          // ie. scheduled = 2021-08-22T11:30:00.000-04:00 => America/New_York
          //     intended  = 2021-08-22T11:30:00.000-05:00 => America/Mexico_City
          return new Date(sched.getTime() + offsetMillis - localOffsetMillis);
        }
      );
    })();

      this.logger?.debug(
        'TaskScheduler -> _addToInternalTaskList - task: ',
        taskConfig.name,
        ' - interval: ',
        taskConfig.intervalText || taskConfig.intervalCron,
        ` - Next Schedules: ${next}`
      );

      this.taskList.push({
        name: taskConfig.name || 'Unknown name',
        maxTaskQueueLength:
          taskConfig.maxTaskQueueLength ||
          this.schedulerConfig.defaultMaxPerTaskQueueLength ||
          Infinity,
        concurrency: taskConcurrency,
        taskConfig: taskConfig,
        input: taskConfig.input,
        schedule,
      });
    } catch (err) {
      this.logger?.error(
        `TaskScheduler -> _addToInternalTaskList - Error:${err}`
      );
      throw err;
    }
  }

  // This function is used to get the offset between the local timezone and the specified timezone
  // This is a workaround for the later.js library not fully supporting timezones
  // This code was taken from the later.js library because it partially supports timezones
  private _getOffset(date: Date, zone: string) {
    const d = (date as any).toLocaleString('en-US', {
        hour12: false,
        timeZone: zone,
        timeZoneName: 'short'
      }) //=> ie. "8/22/2021, 24:30:00 EDT"
      .match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+)/)
      .map((n: any) => (n.length === 1 ? '0' + n : n));

    const zdate = new Date(
      `${d[3]}-${d[1]}-${d[2]}T${d[4].replace('24', '00')}:${d[5]}:${d[6]}Z`
    );

    return date.getTime() - zdate.getTime();
  }
}
