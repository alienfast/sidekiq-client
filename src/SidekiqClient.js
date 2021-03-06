// @flow

import redis from 'redis'
import bluebird from 'bluebird'
import generateJobId from './generateJobId'

// Prepare the redis interface
bluebird.promisifyAll(redis.RedisClient.prototype)

/**
 *
 *    {
 *      "class": "SomeWorker",
 *      "jid": "b4a577edbccf1d805744efa9", // 12-byte random number as 24 char hex string
 *      "args": [1, "arg", true],
 *      "created_at": 1234567890,
 *      "enqueued_at": 1234567890
 *    }
 */
export type Args = Array<string | number | boolean>

export type JobRequest = {
  class: string,
  args: Args,
  queue?: string,
  retry?: boolean,
}

export type Job = {
  ...$Exact<JobRequest>,
  queue: string,
  retry: boolean,
  at?: number,
  jid: string, // 12-byte random number as 24 char hex string
  created_at: number,
  enqueued_at: number,
}

type RedisClient = {
  zaddAsync: (key: string, run_at: number, job: $Supertype<Job>) => Promise<any>,
  lpushAsync: (key: string, job: $Supertype<Job>) => Promise<any>,
  saddAsync: (key: string, job: $Supertype<Job>) => Promise<any>,
}

class SidkiqClient {
  redisClient: Object

  /**
   * Convenience routine to create the promisified redis client
   * @param options
   * @see https://github.com/NodeRedis/node_redis#promises
   */
  static redisCreateClient (options: Object) {
    return redis.createClient(options)
  }

  constructor (redisClient: RedisClient) {
    this.redisClient = redisClient

    if (!this.redisClient) {
      throw new ReferenceError('Expected non-null "redisClient" connection object')
    }
  }

  async enqueue (jobRequest: JobRequest, at?: ?Date = null) {
    const jobId = await generateJobId()
    const now = new Date().getTime() / 1000

    const job: Job = {
      jid: jobId,
      created_at: now,
      enqueued_at: now,
      ...jobRequest
    }

    if (!job.queue) {
      job.queue = 'default'
    }

    if (job.retry === undefined) {
      job.retry = true
    }

    // @see https://github.com/mperham/sidekiq/blob/master/lib/sidekiq/client.rb#L191
    if (at) {
      // Push job scheduled to run at specific time
      job.at = at.getTime() / 1000
      //
      //   ruby: conn.zadd('schedule', payloads)
      const enqueueResponse = await this.redisClient.zaddAsync('schedule', [job.at, JSON.stringify(job)])
      return enqueueResponse
    } else {
      // ensure the queue exists
      //  ruby: conn.sadd('queues', q)
      const queueAdd = await this.redisClient.saddAsync('queues', job.queue) // eslint-disable-line no-unused-vars
      // push the job
      //  ruby: conn.lpush("queue:#{q}", to_push)
      const enqueueResponse = await this.redisClient.lpushAsync(`queue:${job.queue}`, [job.enqueued_at, JSON.stringify(job)])
      return enqueueResponse
    }
  }
}

export default SidkiqClient
