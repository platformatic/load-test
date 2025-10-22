'use strict'

const { readFile } = require('fs/promises')
const { setTimeout } = require('timers/promises')
const { request } = require('undici')

async function parseCSV (filePath) {
  const content = await readFile(filePath, 'utf-8')
  const lines = content.trim().split('\n')

  const requests = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const parts = line.split(',')
    if (parts.length !== 2) {
      throw new Error(`Invalid CSV format at line ${i + 1}: expected 2 columns (time,url), got ${parts.length}`)
    }

    const time = parseFloat(parts[0].trim())
    const url = parts[1].trim()

    if (isNaN(time)) {
      throw new Error(`Invalid time value at line ${i + 1}: ${parts[0]}`)
    }

    if (!url) {
      throw new Error(`Invalid URL at line ${i + 1}: URL cannot be empty`)
    }

    requests.push({ time, url })
  }

  return requests
}

async function executeRequest (url, timeoutMs = 3000) {
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET'
    })

    const timeout = setTimeout(timeoutMs, null, { ref: false }).then(() => {
      throw new Error('Timeout reading first chunk')
    })

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
  const requests = await parseCSV(csvPath)

  if (requests.length === 0) {
    console.log('No requests found in CSV file')
    return
  }

  console.log(`Loaded ${requests.length} requests from ${csvPath}`)
  console.log('Starting load test...\n')

  const startTime = Date.now()
  const firstRequestTime = requests[0].time
  const promises = []

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]
    const relativeTime = req.time - firstRequestTime
    const targetTime = startTime + relativeTime
    const now = Date.now()
    const delay = targetTime - now

    const promise = (async () => {
      if (delay > 0) {
        await setTimeout(delay)
      }
      await executeRequest(req.url, timeoutMs)
    })()

    promises.push(promise)
  }

  await Promise.all(promises)

  console.log('\nAll requests completed')
}

module.exports = { loadTest, parseCSV, executeRequest }
