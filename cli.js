#!/usr/bin/env node
'use strict'

const { parseArgs } = require('node:util')
const { loadTest } = require('./index.js')

const { values, positionals } = parseArgs({
  options: {
    timeout: {
      type: 'string',
      short: 't',
      default: '60000'
    },
    accelerator: {
      type: 'string',
      short: 'a',
      default: '1'
    },
    host: {
      type: 'string',
      short: 'h'
    },
    'no-cache': {
      type: 'boolean',
      default: false
    },
    'skip-header': {
      type: 'boolean',
      default: false
    },
    'no-verify': {
      type: 'boolean',
      default: false
    },
    'reset-connections': {
      type: 'string',
      short: 'r'
    },
    limit: {
      type: 'string',
      short: 'l'
    },
    'count-fallback': {
      type: 'boolean',
      default: false
    }
  },
  allowPositionals: true,
  strict: true
})

const csvPath = positionals[0]
const timeout = parseInt(values.timeout, 10)
const accelerator = parseFloat(values.accelerator)
const hostRewrite = values.host
const noCache = values['no-cache']
const skipHeader = values['skip-header']
const noVerify = values['no-verify']
const resetConnections = values['reset-connections'] ? parseInt(values['reset-connections'], 10) : 0
const limit = values.limit ? parseInt(values.limit, 10) : 0
const countFallback = values['count-fallback']

if (!csvPath) {
  console.error('Error: CSV file path is required')
  console.error('')
  console.error('Usage: load <csv-file> [options]')
  console.error('')
  console.error('Options:')
  console.error('  -t, --timeout <ms>           Timeout in milliseconds for each request (default: 60000)')
  console.error('  -a, --accelerator <n>        Time acceleration factor (default: 1, e.g., 2 = 2x speed, 10 = 10x speed)')
  console.error('  -h, --host <hostname>        Rewrite the host in all URLs to this value (e.g., localhost:3000)')
  console.error('  -r, --reset-connections <n>  Reset connections every N requests (like autocannon -D)')
  console.error('  -l, --limit <n>              Execute only the first N requests from the CSV')
  console.error('  --no-cache                   Add cache=false to the querystring of all URLs')
  console.error('  --skip-header                Skip the first line of the CSV file (useful for headers)')
  console.error('  --no-verify                  Disable HTTPS certificate verification (useful for self-signed certs)')
  console.error('  --count-fallback             Count responses with "fallback": true in metadata')
  console.error('')
  console.error('Example:')
  console.error('  load requests.csv')
  console.error('  load requests.csv --timeout 120000')
  console.error('  load requests.csv --accelerator 10')
  console.error('  load requests.csv --host localhost:3000')
  console.error('  load requests.csv --reset-connections 100')
  console.error('  load requests.csv --limit 100')
  console.error('  load requests.csv --no-cache')
  console.error('  load requests.csv --skip-header')
  console.error('  load requests.csv --no-verify')
  console.error('')
  console.error('CSV Format:')
  console.error('  unix_timestamp_in_milliseconds,url')
  console.error('  1761128950441,https://example.com/api/stream')
  console.error('  1761128950941,https://example.com/api/data')
  process.exit(1)
}

if (isNaN(timeout)) {
  console.error('Error: timeout must be a valid number')
  process.exit(1)
}

if (isNaN(accelerator)) {
  console.error('Error: accelerator must be a valid number')
  process.exit(1)
}

if (accelerator <= 0) {
  console.error('Error: accelerator must be greater than 0')
  process.exit(1)
}

if (resetConnections && (isNaN(resetConnections) || resetConnections <= 0)) {
  console.error('Error: reset-connections must be a positive number')
  process.exit(1)
}

if (limit && (isNaN(limit) || limit <= 0)) {
  console.error('Error: limit must be a positive number')
  process.exit(1)
}

loadTest(csvPath, timeout, accelerator, hostRewrite, noCache, skipHeader, noVerify, resetConnections, limit, countFallback).catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
