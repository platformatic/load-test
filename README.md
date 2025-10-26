# load-test

A Node.js module for simulating HTTP traffic from a recorded CSV file with precise timing. Replays HTTP GET requests at the exact intervals they were recorded.

## Installation

```bash
npm install
```

## Usage

### Command Line

```bash
load <csv-file> [--timeout <ms>] [--accelerator <factor>] [--host <hostname>]
```

Or using Node.js directly:

```bash
node cli.js <csv-file> [--timeout <ms>] [--accelerator <factor>] [--host <hostname>]
```

### Options

- `-t, --timeout <ms>` - Total timeout in milliseconds for each request (default: 60000)
- `-a, --accelerator <n>` - Time acceleration factor (default: 1). Speeds up the delays between request initiations by dividing them by this factor. For example, accelerator=10 makes a 1000ms delay become 100ms. Note: This only affects the timing of when requests are *initiated*, not how long the actual HTTP requests take to complete.
- `-h, --host <hostname>` - Rewrite the host in all URLs to this value (e.g., `localhost:3000`). Useful for replaying production traffic against a local or staging server. The protocol (http/https) and path are preserved from the original URL.

### Examples

```bash
# Basic usage with default 60 second timeout
load example.csv

# Custom timeout of 2 minutes
load example.csv --timeout 120000
load example.csv -t 120000

# Run 10x faster (reduce delays between requests by 10x)
load example.csv --accelerator 10
load example.csv -a 10

# Run 100x faster for quick testing
load example.csv --accelerator 100

# Rewrite all requests to local server
load example.csv --host localhost:3000
load example.csv -h localhost:3000

# Combine options: fast replay against local server
load example.csv --accelerator 100 --host localhost:3000

# Test parallel execution
load example-parallel.csv

# Test with streaming URLs
load example-streaming.csv
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
- The `--accelerator` option can speed up these delays (e.g., with accelerator=10, the 500ms delay becomes 50ms)
- Multiple requests with the same timestamp execute in parallel
- Each request is a GET request that fully consumes the response body via `body.dump()`
- Response bodies are consumed completely to simulate real client behavior
- Only 2xx status codes are considered successful
- 3xx, 4xx, and 5xx responses are logged as errors
- Connection errors and timeouts are logged with detailed information
- Default total request timeout is 60 seconds (configurable via `--timeout`)
- Latency for each request is tracked using `node:perf_hooks` histogram with nanosecond precision
- After all requests complete, detailed statistics are displayed including percentiles (P50, P75, P90, P99)

## Output Example

```bash
$ load example.csv
Starting load test...

✓ https://www.google.com - 200
✓ https://www.github.com - 200
✓ https://www.npmjs.com - 200
✓ https://www.nodejs.org - 200

Waiting for all requests to complete...

=== Latency Statistics ===
Total requests: 4
Successful: 4
Errors: 0
Min: 45.23 ms
Max: 234.56 ms
Mean: 123.45 ms
Stddev: 67.89 ms
P50: 112.34 ms
P75: 156.78 ms
P90: 201.23 ms
P99: 234.56 ms
```

Example with errors:

```bash
✗ ERROR: https://example.com/notfound
  Code: HTTP_404
  Message: HTTP 404
✗ ERROR: http://localhost:9999
  Code: ECONNREFUSED

Waiting for all requests to complete...

=== Latency Statistics ===
Total requests: 4
Successful: 2
Errors: 2
Min: 45.23 ms
Max: 234.56 ms
Mean: 123.45 ms
Stddev: 67.89 ms
P50: 112.34 ms
P75: 156.78 ms
P90: 201.23 ms
P99: 234.56 ms
```

## Error Handling

The module provides detailed error logging:

- **HTTP Status Errors**: Non-2xx responses are logged with their status code (e.g., `HTTP_301`, `HTTP_404`, `HTTP_500`)
- **Connection Errors**: Network errors include the error code (e.g., `ECONNREFUSED`, `ETIMEDOUT`)
- **Timeout Errors**: If a request cannot complete within the specified timeout period (via `AbortSignal.timeout()`)

All errors are logged to stderr with the URL and error details, but the load test continues to execute remaining requests.

## Latency Statistics

After all requests complete, the tool displays comprehensive latency statistics using a high-precision histogram:

- **Total requests**: Total number of requests executed
- **Successful**: Number of requests that received 2xx status codes
- **Errors**: Number of requests that failed (non-2xx responses, connection errors, timeouts)
- **Min/Max**: Minimum and maximum latency observed
- **Mean**: Average latency across all requests
- **Stddev**: Standard deviation of latencies
- **P50/P75/P90/P99**: Latency percentiles showing distribution

Latencies are measured with nanosecond precision using `process.hrtime.bigint()` and displayed in milliseconds. Both successful and failed requests are included in the latency measurements.

## Testing

```bash
npm test
```

Runs the test suite using Node.js built-in test runner.
