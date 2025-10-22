'use strict'

const { createReadStream } = require('fs')
const { pipeline } = require('stream/promises')
const { Transform } = require('stream')
const { createInterface } = require('readline')
const { Agent, request, interceptors } = require('undici')
const { setTimeout } = require('timers/promises')
const { dump } = interceptors

const agent = new Agent().compose(
  dump({
    maxSize: 1024 // just a small size to ensure body is consumed
  })
)

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

async function executeRequest (url, timeoutMs = 3000) {
  try {
    const { statusCode } = await request(url, {
      method: 'GET',
      dispatcher: agent, // Use the agent with dump interceptor to automatically consume response body
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      connectionTimeout: timeoutMs
      // This would be ideal to have a total timeout, but hanging with the dump interceptor
      // TODO: investigate further
      // signal: AbortSignal.timeout(timeoutMs) 
    })

    if (statusCode < 200 || statusCode >= 300) {
      const err = new Error(`HTTP ${statusCode}`)
      err.code = `HTTP_${statusCode}`
      throw err
    }

    console.log(`✓ ${url} - ${statusCode}`)
    return { success: true, url, statusCode }
  } catch (err) {
    console.error(`✗ ERROR: ${url}`)
    if (err.code) {
      console.error(`  Code: ${err.code}`)
    }
    if (err.message && err.message !== `HTTP ${err.code?.replace('HTTP_', '')}`) {
      console.error(`  Message: ${err.message}`)
    }
    if (err.cause) {
      console.error(`  Cause: ${err.cause.message}`)
    }
    return { success: false, url, error: err }
  }
}

async function loadTest (csvPath, timeoutMs = 3000) {
  console.log('Starting load test...\n')

  const startTime = Date.now()
  let firstRequestTime = null

  for await (const req of parseCSV(csvPath)) {
    if (firstRequestTime === null) {
      firstRequestTime = req.time
    }

    const relativeTime = req.time - firstRequestTime
    const targetTime = startTime + relativeTime
    const now = Date.now()
    const delay = targetTime - now

    if (delay > 0) {
      await setTimeout(delay)
    }

    executeRequest(req.url, timeoutMs)
  }

  if (firstRequestTime === null) {
    console.log('No requests found in CSV file')
    return
  }

  console.log('\nAll requests initiated')
}

module.exports = { loadTest, parseCSV, executeRequest }
