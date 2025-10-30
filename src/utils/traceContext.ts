/**
 * W3C Trace Context utilities
 * 
 * Implements W3C Trace Context specification for distributed tracing:
 * https://www.w3.org/TR/trace-context/
 * 
 * Features:
 * - Parse and generate traceparent headers
 * - Handle tracestate propagation  
 * - Generate correlation IDs
 * - Future OpenTelemetry compatibility
 */

import { randomBytes } from 'node:crypto'

// W3C Trace Context constants
const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const TRACE_FLAGS = {
  SAMPLED: 0x01,
  NOT_SAMPLED: 0x00
}

/**
 * Parsed W3C traceparent header
 */
export interface TraceParent {
  version: string
  traceId: string
  spanId: string
  flags: number
}

/**
 * W3C tracestate header (key-value pairs)
 */
export type TraceState = Record<string, string>

/**
 * Generate a random trace ID (32 hex chars)
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Generate a random span ID (16 hex chars)
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Generate a correlation ID (UUID v4 format)
 */
export function generateCorrelationId(): string {
  const bytes = randomBytes(16)
  
  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  
  return [
    bytes.subarray(0, 4).toString('hex'),
    bytes.subarray(4, 6).toString('hex'),
    bytes.subarray(6, 8).toString('hex'),
    bytes.subarray(8, 10).toString('hex'),
    bytes.subarray(10, 16).toString('hex')
  ].join('-')
}

/**
 * Parse W3C traceparent header
 */
export function parseTraceParent(traceparent: string): TraceParent | null {
  const match = traceparent.match(TRACEPARENT_REGEX)
  
  if (!match) {
    return null
  }
  
  const [, version, traceId, spanId, flags] = match
  
  // Validate version (currently only 00 is supported)
  if (version !== '00') {
    return null
  }
  
  // Validate trace ID (cannot be all zeros)
  if (traceId === '00000000000000000000000000000000') {
    return null
  }
  
  // Validate span ID (cannot be all zeros)
  if (spanId === '0000000000000000') {
    return null
  }
  
  return {
    version,
    traceId,
    spanId,
    flags: parseInt(flags, 16)
  }
}

/**
 * Generate W3C traceparent header
 */
export function generateTraceParent(
  traceId?: string,
  parentSpanId?: string,
  sampled: boolean = false
): string {
  const finalTraceId = traceId || generateTraceId()
  const finalSpanId = generateSpanId() // Always generate new span ID
  const flags = sampled ? TRACE_FLAGS.SAMPLED : TRACE_FLAGS.NOT_SAMPLED
  
  return `00-${finalTraceId}-${finalSpanId}-${flags.toString(16).padStart(2, '0')}`
}

/**
 * Parse W3C tracestate header
 */
export function parseTraceState(tracestate?: string): TraceState {
  if (!tracestate) {
    return {}
  }
  
  const state: TraceState = {}
  
  // Split by comma and parse key-value pairs
  const pairs = tracestate.split(',').map(pair => pair.trim())
  
  for (const pair of pairs) {
    const [key, value] = pair.split('=', 2)
    if (key && value) {
      state[key.trim()] = value.trim()
    }
  }
  
  return state
}

/**
 * Serialize W3C tracestate to header string
 */
export function serializeTraceState(tracestate: TraceState): string {
  return Object.entries(tracestate)
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

/**
 * Create child span from existing trace context
 */
export function createChildSpan(
  parentTraceParent: TraceParent,
  sampled?: boolean
): string {
  const flags = sampled !== undefined 
    ? (sampled ? TRACE_FLAGS.SAMPLED : TRACE_FLAGS.NOT_SAMPLED)
    : parentTraceParent.flags
    
  return generateTraceParent(parentTraceParent.traceId, parentTraceParent.spanId, flags === TRACE_FLAGS.SAMPLED)
}

/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>) {
  const traceparent = Array.isArray(headers.traceparent) 
    ? headers.traceparent[0] 
    : headers.traceparent
    
  const tracestate = Array.isArray(headers.tracestate)
    ? headers.tracestate[0]
    : headers.tracestate
    
  const correlationId = Array.isArray(headers['x-correlation-id'])
    ? headers['x-correlation-id'][0]
    : headers['x-correlation-id']
  
  return {
    traceparent: traceparent ? parseTraceParent(traceparent) : null,
    tracestate: parseTraceState(tracestate),
    correlationId: correlationId || generateCorrelationId()
  }
}

/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(
  headers: Record<string, string>,
  traceparent: string,
  tracestate?: TraceState,
  correlationId?: string
): void {
  headers.traceparent = traceparent
  
  if (tracestate && Object.keys(tracestate).length > 0) {
    headers.tracestate = serializeTraceState(tracestate)
  }
  
  if (correlationId) {
    headers['x-correlation-id'] = correlationId
  }
}

/**
 * Create trace context for new request (root span)
 */
export function createRootTraceContext(correlationId?: string) {
  const finalCorrelationId = correlationId || generateCorrelationId()
  const traceparent = generateTraceParent()
  const parsed = parseTraceParent(traceparent)!
  
  return {
    traceparent,
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    correlationId: finalCorrelationId,
    tracestate: {}
  }
}

/**
 * Validate trace ID format
 */
export function isValidTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/.test(traceId) && traceId !== '00000000000000000000000000000000'
}

/**
 * Validate span ID format  
 */
export function isValidSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/.test(spanId) && spanId !== '0000000000000000'
}

/**
 * Check if trace is sampled
 */
export function isSampled(flags: number): boolean {
  return (flags & TRACE_FLAGS.SAMPLED) === TRACE_FLAGS.SAMPLED
}