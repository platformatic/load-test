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

if (!csvPath) {
  console.error('Error: CSV file path is required')
  console.error('')
  console.error('Usage: load <csv-file> [--timeout <ms>] [--accelerator <factor>] [--host <hostname>] [--no-cache] [--skip-header] [--no-verify]')
  console.error('')
  console.error('Options:')
  console.error('  -t, --timeout <ms>      Timeout in milliseconds for each request (default: 60000)')
  console.error('  -a, --accelerator <n>   Time acceleration factor (default: 1, e.g., 2 = 2x speed, 10 = 10x speed)')
  console.error('  -h, --host <hostname>   Rewrite the host in all URLs to this value (e.g., localhost:3000)')
  console.error('  --no-cache              Add cache=false to the querystring of all URLs')
  console.error('  --skip-header           Skip the first line of the CSV file (useful for headers)')
  console.error('  --no-verify             Disable HTTPS certificate verification (useful for self-signed certs)')
  console.error('')
  console.error('Example:')
  console.error('  load requests.csv')
  console.error('  load requests.csv --timeout 120000')
  console.error('  load requests.csv --accelerator 10')
  console.error('  load requests.csv --host localhost:3000')
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

loadTest(csvPath, timeout, accelerator, hostRewrite, noCache, skipHeader, noVerify).catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
