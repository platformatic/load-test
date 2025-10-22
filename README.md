# load-test

A Node.js module for simulating HTTP traffic from a recorded CSV file with precise timing. Replays HTTP GET requests at the exact intervals they were recorded.

## Installation

```bash
npm install
```

## Usage

### Command Line

```bash
load <csv-file> [--timeout <ms>]
```

Or using Node.js directly:

```bash
node cli.js <csv-file> [--timeout <ms>]
```

### Options

- `-t, --timeout <ms>` - Timeout in milliseconds for reading the first chunk of each response (default: 3000)

### Examples

```bash
# Basic usage with default 3 second timeout
load requests.csv

# Custom timeout of 5 seconds
load requests.csv --timeout 5000
load requests.csv -t 5000

# Test parallel execution
load example-parallel.csv
```

## CSV Format

The CSV file should contain two columns: Unix timestamp in milliseconds and URL.

```csv
1761128950441,https://example.com/api/stream
1761128950941,https://example.com/api/data
1761128951441,https://example.com/api/users
1761128952441,https://example.com/api/status
```

**Format:** `unix_timestamp_in_milliseconds,url`

You can generate timestamps in JavaScript:
```javascript
Date.now() // Returns current time in milliseconds
```

## How It Works

- Requests execute in parallel based on their timestamps
- The first request(s) execute immediately when the load test starts
- Subsequent requests execute at intervals relative to the first request's timestamp
- For example, a request at timestamp `1761128950941` executes 500ms after a request at `1761128950441`
- Multiple requests with the same timestamp execute in parallel
- Each request is a GET request that starts streaming the response by reading the first chunk
- Only 2xx status codes are considered successful
- 3xx, 4xx, and 5xx responses are logged as errors
- Connection errors and timeouts are logged with detailed information
- Default timeout for reading the first chunk is 3 seconds (configurable)

## Output Example

```bash
$ load example.csv
Loaded 4 requests from example.csv
Starting load test...

✓ https://example.com/api/stream - 200
✓ https://example.com/api/data - 200

All requests initiated
✗ ERROR: https://example.com/api/users
  Code: HTTP_404
✗ ERROR: https://example.com/api/timeout
  Code: ECONNREFUSED
```

## Error Handling

The module provides detailed error logging:

- **HTTP Status Errors**: Non-2xx responses are logged with their status code (e.g., `HTTP_301`, `HTTP_404`, `HTTP_500`)
- **Connection Errors**: Network errors include the error code (e.g., `ECONNREFUSED`, `ETIMEDOUT`)
- **Timeout Errors**: If a response chunk cannot be read within the timeout period

All errors are logged to stderr with the URL and error details, but the load test continues to execute remaining requests.

## Testing

```bash
npm test
```

Runs the test suite using Node.js built-in test runner.
