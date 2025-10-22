'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { writeFile, mkdir, rm } = require('fs/promises')
const { join } = require('path')
const { parseCSV, executeRequest, loadTest } = require('../index.js')
const { createServer } = require('http')

test('parseCSV - parses valid CSV file', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test.csv')

  await writeFile(csvPath, '1761128950441,https://example.com\n1761128950941,https://test.com\n1761128951441,https://api.com')

  const requests = await parseCSV(csvPath)

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

  const requests = await parseCSV(csvPath)

  assert.strictEqual(requests.length, 2)

  await rm(tmpDir, { recursive: true })
})

test('parseCSV - throws on invalid format', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-invalid.csv')

  await writeFile(csvPath, '1761128950441,https://example.com,extra')

  await assert.rejects(
    async () => await parseCSV(csvPath),
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
    async () => await parseCSV(csvPath),
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
    async () => await parseCSV(csvPath),
    /Invalid URL at line 1/
  )

  await rm(tmpDir, { recursive: true })
})

test('executeRequest - successful GET request', async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('test response')
  })

  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  const url = `http://localhost:${port}`

  const result = await executeRequest(url)

  assert.strictEqual(result.success, true)
  assert.strictEqual(result.url, url)
  assert.strictEqual(result.statusCode, 200)

  server.close()
})

test('executeRequest - handles streaming response', async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.write('chunk1')
    res.write('chunk2')
    res.end('chunk3')
  })

  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  const url = `http://localhost:${port}`

  const result = await executeRequest(url)

  assert.strictEqual(result.success, true)
  assert.strictEqual(result.statusCode, 200)

  server.close()
})

test('executeRequest - handles connection errors', async (t) => {
  const url = 'http://localhost:1'

  const result = await executeRequest(url)

  assert.strictEqual(result.success, false)
  assert.strictEqual(result.url, url)
  assert.ok(result.error)
})

test('loadTest - executes requests with timing', async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
  })

  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  const url = `http://localhost:${port}`

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
  server.close()
})

test('loadTest - handles empty CSV', async (t) => {
  const tmpDir = join(__dirname, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const csvPath = join(tmpDir, 'test-empty-file.csv')

  await writeFile(csvPath, '')

  await loadTest(csvPath)

  await rm(tmpDir, { recursive: true })
})
