'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert')
const { writeFile, mkdir, rm } = require('fs/promises')
const { setTimeout } = require('timers/promises')
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

test('parseCSV - parses scientific notation timestamps', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-scientific.csv')

  await writeFile(csvPath, '1.761317942115E12,https://example.com\n1.761317943115E12,https://test.com')

  const requests = []
  for await (const req of parseCSV(csvPath)) {
    requests.push(req)
  }

  assert.strictEqual(requests.length, 2)
  assert.strictEqual(requests[0].time, 1761317942115)
  assert.strictEqual(requests[0].url, 'https://example.com')
  assert.strictEqual(requests[1].time, 1761317943115)
  assert.strictEqual(requests[1].url, 'https://test.com')

  await rm(tmpDir, { recursive: true })
})

test('parseCSV - skips first line with skipHeader', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-skip-header.csv')

  await writeFile(csvPath, 'time,url\n1761128950441,https://example.com\n1761128950941,https://test.com')

  const requests = []
  for await (const req of parseCSV(csvPath, true)) {
    requests.push(req)
  }

  assert.strictEqual(requests.length, 2)
  assert.strictEqual(requests[0].time, 1761128950441)
  assert.strictEqual(requests[0].url, 'https://example.com')
  assert.strictEqual(requests[1].time, 1761128950941)
  assert.strictEqual(requests[1].url, 'https://test.com')

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
  const { Readable } = require('stream')
  const app = fastify()

  app.get('/', async (request, reply) => {
    const stream = Readable.from(async function * () {
      yield 'chunk1\n'
      await setTimeout(10)
      yield 'chunk2\n'
      await setTimeout(10)
      yield 'chunk3\n'
    }())

    reply.header('Content-Type', 'text/plain')
    return stream
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

test('executeRequest - handles request timeout', async (t) => {
  const app = fastify()

  app.get('/', async (request, reply) => {
    await setTimeout(500)
    return 'delayed response'
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const url = `http://localhost:${app.server.address().port}`
  const result = await executeRequest(url, 100)

  assert.strictEqual(result.success, false)
  assert.strictEqual(result.url, url)
  assert.ok(result.error)
  assert.ok(result.error.message.includes('aborted') || result.error.message.includes('timeout'))
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

test('loadTest - host rewrite changes URL host', async (t) => {
  const app = fastify()
  const requestedUrls = []

  app.get('/api/test', async (request, reply) => {
    requestedUrls.push(`http://${request.headers.host}${request.url}`)
    return { ok: true }
  })

  app.get('/api/data', async (request, reply) => {
    requestedUrls.push(`http://${request.headers.host}${request.url}`)
    return { ok: true }
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const localPort = app.server.address().port
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-host-rewrite.csv')

  const now = Date.now()
  await writeFile(csvPath, `${now},http://example.com/api/test\n${now},http://other.com/api/data`)

  await loadTest(csvPath, 60000, 1, `localhost:${localPort}`)

  assert.strictEqual(requestedUrls.length, 2)
  assert.strictEqual(requestedUrls[0], `http://localhost:${localPort}/api/test`)
  assert.strictEqual(requestedUrls[1], `http://localhost:${localPort}/api/data`)

  await rm(tmpDir, { recursive: true })
})

test('loadTest - handles scientific notation with accelerator', async (t) => {
  const app = fastify()

  app.get('/', async (request, reply) => {
    return 'ok'
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const url = `http://localhost:${app.server.address().port}`

  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-scientific-accelerator.csv')

  await writeFile(csvPath, `1.761317942115E12,${url}\n1.761317943115E12,${url}\n1.761317944115E12,${url}`)

  const start = Date.now()
  await loadTest(csvPath, 60000, 10)
  const duration = Date.now() - start

  assert.ok(duration >= 200, `Expected duration >= 200ms, got ${duration}ms`)
  assert.ok(duration < 500, `Expected duration < 500ms, got ${duration}ms`)

  await rm(tmpDir, { recursive: true })
})

test('loadTest - adds cache=false to querystring with --no-cache', async (t) => {
  const app = fastify()
  const requestedUrls = []

  app.get('/api/test', async (request, reply) => {
    requestedUrls.push(request.url)
    return { ok: true }
  })

  app.get('/api/data', async (request, reply) => {
    requestedUrls.push(request.url)
    return { ok: true }
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const localPort = app.server.address().port
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-no-cache.csv')

  const now = Date.now()
  await writeFile(csvPath, `${now},http://localhost:${localPort}/api/test\n${now},http://localhost:${localPort}/api/data?foo=bar`)

  await loadTest(csvPath, 60000, 1, null, true)

  assert.strictEqual(requestedUrls.length, 2)
  assert.strictEqual(requestedUrls[0], '/api/test?cache=false')
  assert.strictEqual(requestedUrls[1], '/api/data?foo=bar&cache=false')

  await rm(tmpDir, { recursive: true })
})

test('loadTest - skips header line with skipHeader flag', async (t) => {
  const app = fastify()

  app.get('/', async (request, reply) => {
    return 'ok'
  })

  await app.listen({ port: 0 })
  t.after(() => app.close())

  const url = `http://localhost:${app.server.address().port}`

  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-skip-header-loadtest.csv')

  const now = Date.now()
  await writeFile(csvPath, `time,url\n${now},${url}\n${now + 100},${url}`)

  await loadTest(csvPath, 60000, 1, null, false, true)

  await rm(tmpDir, { recursive: true })
})
