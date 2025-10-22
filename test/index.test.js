'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert')
const { writeFile, mkdir, rm } = require('fs/promises')
const { join } = require('path')
const { parseCSV, executeRequest, loadTest } = require('../index.js')
const fastify = require('fastify')


test('parseCSV - parses valid CSV file', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test.csv')

  await writeFile(csvPath, '1761128950441,https://example.com\n1761128950941,https://test.com\n1761128951441,https://api.com')

  const requests = []
  for await (const req of parseCSV(csvPath)) {
    requests.push(req)
  }

  assert.strictEqual(requests.length, 3)
  assert.strictEqual(requests[0].time, 1761128950441)
  assert.strictEqual(requests[0].url, 'https://example.com')
  assert.strictEqual(requests[1].time, 1761128950941)
  assert.strictEqual(requests[1].url, 'https://test.com')
  assert.strictEqual(requests[2].time, 1761128951441)
  assert.strictEqual(requests[2].url, 'https://api.com')

  await rm(tmpDir, { recursive: true })
})

test('parseCSV - handles empty lines', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-empty.csv')

  await writeFile(csvPath, '1761128950441,https://example.com\n\n1761128950941,https://test.com\n')

  const requests = []
  for await (const req of parseCSV(csvPath)) {
    requests.push(req)
  }

  assert.strictEqual(requests.length, 2)

  await rm(tmpDir, { recursive: true })
})

test('parseCSV - throws on invalid format', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-invalid.csv')

  await writeFile(csvPath, '1761128950441,https://example.com,extra')

  await assert.rejects(
    async () => {
      for await (const req of parseCSV(csvPath)) {
        // Should throw before yielding
      }
    },
    /Invalid CSV format at line 1/
  )

  await rm(tmpDir, { recursive: true })
})

test('parseCSV - throws on invalid time', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-bad-time.csv')

  await writeFile(csvPath, 'invalid,https://example.com')

  await assert.rejects(
    async () => {
      for await (const req of parseCSV(csvPath)) {
        // Should throw before yielding
      }
    },
    /Invalid time value at line 1/
  )

  await rm(tmpDir, { recursive: true })
})

test('parseCSV - throws on empty URL', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-empty-url.csv')

  await writeFile(csvPath, '1761128950441,')

  await assert.rejects(
    async () => {
      for await (const req of parseCSV(csvPath)) {
        // Should throw before yielding
      }
    },
    /Invalid URL at line 1/
  )

  await rm(tmpDir, { recursive: true })
})

test('executeRequest - successful GET request', async (t) => {
  const app = fastify()

  app.get('/', async (request, reply) => {
    return 'test response'
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const url = `http://localhost:${app.server.address().port}`

  const result = await executeRequest(url)

  assert.strictEqual(result.success, true)
  assert.strictEqual(result.url, url)
  assert.strictEqual(result.statusCode, 200)
})

test('executeRequest - handles streaming response', async (t) => {
  const app = fastify()

  app.get('/', async (request, reply) => {
    reply.header('Content-Type', 'text/plain')
    return 'chunk1chunk2chunk3'
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const url = `http://localhost:${app.server.address().port}`

  const result = await executeRequest(url)

  assert.strictEqual(result.success, true)
  assert.strictEqual(result.statusCode, 200)
})

test('executeRequest - handles connection errors', async (t) => {
  const url = 'http://localhost:1'

  const result = await executeRequest(url)

  assert.strictEqual(result.success, false)
  assert.strictEqual(result.url, url)
  assert.ok(result.error)
})

test('executeRequest - handles body timeout with dump interceptor', async (t) => {
  const { createServer } = require('http')
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.flushHeaders()
    // Don't write body data or end - let it hang after headers are sent
    // The dump interceptor will handle this gracefully
  })

  await new Promise((resolve) => server.listen(0, resolve))
  t.after(() => server.close())

  const port = server.address().port
  const url = `http://localhost:${port}`

  const result = await executeRequest(url, 100)

  // With dump interceptor, the request succeeds once headers are received
  // The interceptor handles body consumption/timeout gracefully
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.url, url)
  assert.strictEqual(result.statusCode, 200)
})

test('loadTest - executes requests with timing', async (t) => {
  const app = fastify()

  app.get('/', async (request, reply) => {
    return 'ok'
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const url = `http://localhost:${app.server.address().port}`

  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-timing.csv')

  const now = Date.now()
  await writeFile(csvPath, `${now},${url}\n${now + 100},${url}\n${now + 200},${url}`)

  const start = Date.now()
  await loadTest(csvPath)
  const duration = Date.now() - start

  assert.ok(duration >= 200, `Expected duration >= 200ms, got ${duration}ms`)
  assert.ok(duration < 500, `Expected duration < 500ms, got ${duration}ms`)

  await rm(tmpDir, { recursive: true })
})

test('loadTest - handles empty CSV', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-empty-file.csv')

  await writeFile(csvPath, '')

  await loadTest(csvPath)

  await rm(tmpDir, { recursive: true })
})
