'use strict'

const { createReadStream } = require('fs')
const { pipeline } = require('stream/promises')
const { Transform } = require('stream')
const { createInterface } = require('readline')
const { request } = require('undici')
const { setTimeout } = require('timers/promises')
const { createHistogram } = require('node:perf_hooks')

function parseCSV (filePath) {
  const fileStream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  let lineNumber = 0

  const parseTransform = new Transform({
    objectMode: true,
    async transform (line, encoding, callback) {
      lineNumber++
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        callback()
        return
      }

      const parts = trimmedLine.split(',')
      if (parts.length !== 2) {
        callback(new Error(`Invalid CSV format at line ${lineNumber}: expected 2 columns (time,url), got ${parts.length}`))
        return
      }

      const time = parseFloat(parts[0].trim())
      const url = parts[1].trim()

      if (isNaN(time)) {
        callback(new Error(`Invalid time value at line ${lineNumber}: ${parts[0]}`))
        return
      }

      if (!url) {
        callback(new Error(`Invalid URL at line ${lineNumber}: URL cannot be empty`))
        return
      }

      callback(null, { time, url })
    }
  })

  pipeline(rl, parseTransform).catch((err) => {
    parseTransform.destroy(err)
  })

  return parseTransform
}

async function executeRequest (url, timeoutMs = 60000, histogram = null) {
  const startTime = process.hrtime.bigint()
  let latencyNs
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })
    await body.dump() // Consume the response body to simulate a real client

    if (statusCode < 200 || statusCode >= 300) {
      const err = new Error(`HTTP ${statusCode}`)
      err.code = `HTTP_${statusCode}`
      throw err
    }

    console.log(`✓ ${url} - ${statusCode}`)
    return { success: true, url, statusCode, latency: Number(latencyNs) }
  } catch (err) {
    console.error(`✗ ERROR: ${url}`)
    if (err.code) {
      console.error(`  Code: ${err.code}`)
    }
    if (err.message) {
      console.error(`  Message: ${err.message}`)
    }
    return { success: false, url, error: err, latency: Number(latencyNs) }
  } finally {
    const endTime = process.hrtime.bigint()
    latencyNs = endTime - startTime

    if (histogram) {
      histogram.record(latencyNs)
    }
  }
}

async function loadTest (csvPath, timeoutMs = 60000, accelerator = 1) {
  console.log('Starting load test...')
  if (accelerator !== 1) {
    console.log(`Time acceleration: ${accelerator}x\n`)
  } else {
    console.log('')
  }

  const histogram = createHistogram()
  const startTime = Date.now()
  let firstRequestTime = null
  let inFlightRequests = 0
  let allRequestsInitiated = false
  let resolveCompletion
  let errorCount = 0

  const completionPromise = new Promise((resolve) => {
    resolveCompletion = resolve
  })

  const checkCompletion = () => {
    if (allRequestsInitiated && inFlightRequests === 0) {
      resolveCompletion()
    }
  }

  const wrappedExecuteRequest = async (url) => {
    inFlightRequests++
    try {
      const result = await executeRequest(url, timeoutMs, histogram)
      if (!result.success) {
        errorCount++
      }
      return result
    } finally {
      inFlightRequests--
      checkCompletion()
    }
  }

  for await (const req of parseCSV(csvPath)) {
    if (firstRequestTime === null) {
      firstRequestTime = req.time
    }

    const relativeTime = req.time - firstRequestTime
    const acceleratedTime = relativeTime / accelerator
    const targetTime = startTime + acceleratedTime
    const now = Date.now()
    const delay = targetTime - now

    if (delay > 0) {
      await setTimeout(delay)
    }

    wrappedExecuteRequest(req.url)
  }

  if (firstRequestTime === null) {
    console.log('No requests found in CSV file')
    return
  }

  console.log('Waiting for all requests to complete...\n')

  allRequestsInitiated = true
  checkCompletion()

  await completionPromise

  console.log('=== Latency Statistics ===')
  console.log(`Total requests: ${histogram.count}`)
  console.log(`Successful: ${histogram.count - errorCount}`)
  console.log(`Errors: ${errorCount}`)
  console.log(`Min: ${(histogram.min / 1_000_000).toFixed(2)} ms`)
  console.log(`Max: ${(histogram.max / 1_000_000).toFixed(2)} ms`)
  console.log(`Mean: ${(histogram.mean / 1_000_000).toFixed(2)} ms`)
  console.log(`Stddev: ${(histogram.stddev / 1_000_000).toFixed(2)} ms`)
  console.log(`P50: ${(histogram.percentile(50) / 1_000_000).toFixed(2)} ms`)
  console.log(`P75: ${(histogram.percentile(75) / 1_000_000).toFixed(2)} ms`)
  console.log(`P90: ${(histogram.percentile(90) / 1_000_000).toFixed(2)} ms`)
  console.log(`P99: ${(histogram.percentile(99) / 1_000_000).toFixed(2)} ms`)
}

module.exports = { loadTest, parseCSV, executeRequest }
