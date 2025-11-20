'use strict'

const { createReadStream } = require('fs')
const { pipeline } = require('stream/promises')
const { Transform } = require('stream')
const { createInterface } = require('readline')
const { request, Agent } = require('undici')
const { setTimeout } = require('timers/promises')
const { createHistogram } = require('node:perf_hooks')

function parseCSV (filePath, skipHeader = false) {
  const fileStream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  let lineNumber = 0
  let firstLineSkipped = false

  const parseTransform = new Transform({
    objectMode: true,
    async transform (line, encoding, callback) {
      lineNumber++
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        callback()
        return
      }

      if (skipHeader && !firstLineSkipped) {
        firstLineSkipped = true
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

async function executeRequest (url, timeoutMs = 60000, histogram = null, dispatcher = null) {
  const startTime = process.hrtime.bigint()
  let latencyNs
  try {
    const options = {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    }
    if (dispatcher) {
      options.dispatcher = dispatcher
    }
    const { statusCode, body } = await request(url, options)
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

async function loadTest (csvPath, timeoutMs = 60000, accelerator = 1, hostRewrite = null, noCache = false, skipHeader = false, noVerify = false, resetConnections = 0) {
  console.log('Starting load test...')
  if (accelerator !== 1) {
    console.log(`Time acceleration: ${accelerator}x`)
  }
  if (hostRewrite) {
    console.log(`Host rewrite: ${hostRewrite}`)
  }
  if (noCache) {
    console.log('Cache busting: enabled (cache=false)')
  }
  if (skipHeader) {
    console.log('Skipping first line: enabled')
  }
  if (noVerify) {
    console.log('Certificate verification: disabled')
  }
  if (resetConnections > 0) {
    console.log(`Connection reset: every ${resetConnections} requests`)
  }
  if (accelerator !== 1 || hostRewrite || noCache || skipHeader || noVerify || resetConnections > 0) {
    console.log('')
  }

  const createDispatcher = () => {
    if (resetConnections > 0 || noVerify) {
      return new Agent({
        connect: {
          rejectUnauthorized: !noVerify
        }
      })
    }
    return null
  }

  let dispatcher = createDispatcher()
  let requestCounter = 0

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
    // Capture current dispatcher reference for this request
    const requestDispatcher = dispatcher

    inFlightRequests++
    try {
      const result = await executeRequest(url, timeoutMs, histogram, requestDispatcher)
      if (!result.success) {
        errorCount++
      }

      if (resetConnections > 0) {
        requestCounter++
        if (requestCounter >= resetConnections) {
          // Close old dispatcher gracefully (waits for in-flight requests)
          if (dispatcher) {
            dispatcher.close()  // Don't await - let it drain in background
          }
          // Create new dispatcher for subsequent requests
          dispatcher = createDispatcher()
          requestCounter = 0
        }
      }

      return result
    } finally {
      inFlightRequests--
      checkCompletion()
    }
  }

  for await (const req of parseCSV(csvPath, skipHeader)) {
    if (firstRequestTime === null) {
      firstRequestTime = req.time
    }

    const relativeTime = req.time - firstRequestTime
    const acceleratedTime = Math.floor(relativeTime / accelerator)
    const targetTime = startTime + acceleratedTime
    const now = Date.now()
    const delay = targetTime - now

    if (delay > 0) {
      await setTimeout(delay)
    }

    let url = req.url
    if (hostRewrite || noCache) {
      const urlObj = new URL(url)
      if (hostRewrite) {
        urlObj.host = hostRewrite
      }
      if (noCache) {
        urlObj.searchParams.set('cache', 'false')
      }
      url = urlObj.toString()
    }

    wrappedExecuteRequest(url)
  }

  if (firstRequestTime === null) {
    console.log('No requests found in CSV file')
    return
  }

  console.log('Waiting for all requests to complete...\n')

  allRequestsInitiated = true
  checkCompletion()

  await completionPromise

  // Close current dispatcher
  if (dispatcher) {
    await dispatcher.close()
  }

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
