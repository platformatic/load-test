'use strict'

const { createReadStream } = require('fs')
const { pipeline } = require('stream/promises')
const { Transform } = require('stream')
const { createInterface } = require('readline')
const { setTimeout } = require('timers/promises')
const { request } = require('undici')

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
    // We support only GET
    const { statusCode, body } = await request(url, {
      method: 'GET'
    })

    const timeout = setTimeout(timeoutMs, null, { ref: false }).then(() => {
      throw new Error('Timeout reading first chunk')
    })

    //...and read only the first chunk to consider the request successful
    const readChunk = (async () => {
      for await (const _ of body) {
        break
      }
    })()

    await Promise.race([readChunk, timeout])

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
